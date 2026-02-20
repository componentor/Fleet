import { Hono } from 'hono';
import { z } from 'zod';
import { db, services, deployments, oauthProviders, insertReturning, eq, and, isNull, inArray } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { githubService, getGitHubConfig } from '../services/github.service.js';
import { buildService } from '../services/build.service.js';
import { dockerService } from '../services/docker.service.js';
import { requireMember } from '../middleware/rbac.js';
import { requireActiveSubscription } from '../middleware/subscription.js';
import { getDeploymentQueue, isQueueAvailable } from '../services/queue.service.js';
import type { DeploymentJobData } from '../workers/deployment.worker.js';
import { logger } from '../services/logger.js';
import { decrypt } from '../services/crypto.service.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';

// ── fleet.json manifest schema ───────────────────────────────────────────────
const fleetManifestSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().url().optional(),
  website: z.string().url().optional(),
  env: z.record(z.union([
    z.string(),
    z.object({
      description: z.string().max(200).optional(),
      value: z.string().optional(),
      required: z.boolean().optional(),
      generate: z.boolean().optional(),
    }),
  ])).optional(),
  ports: z.array(z.object({
    target: z.number().int().min(1).max(65535),
    published: z.number().int().min(1).max(65535).optional(),
    protocol: z.enum(['tcp', 'udp']).optional(),
  })).optional(),
  buildFile: z.string().max(200).optional(),
  branch: z.string().max(200).optional(),
}).strict();

export type FleetManifest = z.infer<typeof fleetManifestSchema>;

// Inline fallback for local dev when Valkey/BullMQ is not available.
// Imports the worker's processor and runs it in-process.
async function enqueueOrRunDeployment(data: DeploymentJobData) {
  if (isQueueAvailable()) {
    await getDeploymentQueue().add('build-and-deploy', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    });
  } else {
    // Fire-and-forget fallback (single-instance dev mode)
    import('../workers/deployment.worker.js').then(({ processDeploymentInline }) =>
      processDeploymentInline(data).catch(async (err) => {
        logger.error({ err, deploymentId: data.deploymentId }, `Build failed for deployment ${data.deploymentId}`);
        // Safety net: only mark as failed if the worker didn't already handle it
        // (the worker's own catch handlers write the detailed build log — don't overwrite)
        try {
          const current = await db.query.deployments.findFirst({
            where: eq(deployments.id, data.deploymentId),
            columns: { status: true },
          });
          if (current && current.status !== 'succeeded' && current.status !== 'failed') {
            await db.update(deployments)
              .set({ status: 'failed', log: `Deployment failed: ${String(err)}`, completedAt: new Date() })
              .where(eq(deployments.id, data.deploymentId));
            await db.update(services)
              .set({ status: 'failed', updatedAt: new Date() })
              .where(eq(services.id, data.serviceId));
          }
        } catch (dbErr) {
          logger.error({ err: dbErr }, 'Failed to mark deployment as failed in DB');
        }
      }),
    );
  }
}

// --- GitHub Webhook (unauthenticated, signature-verified) ---
const webhookRoutes = new Hono();

webhookRoutes.post('/github/webhook', async (c) => {
  const ghConfig = await getGitHubConfig();
  const webhookSecret = ghConfig.webhookSecret;
  if (!webhookSecret) {
    return c.json({ error: 'Webhook secret not configured' }, 500);
  }

  const signature = c.req.header('X-Hub-Signature-256');
  if (!signature) {
    return c.json({ error: 'Missing signature' }, 401);
  }

  const rawBody = await c.req.text();

  if (!githubService.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const event = c.req.header('X-GitHub-Event');
  const payload = JSON.parse(rawBody) as Record<string, unknown>;

  let branch: string;
  let repoFullName: string;
  let commitSha: string;
  let triggerMessage: string;

  if (event === 'push') {
    const ref = payload['ref'] as string; // "refs/heads/main"
    branch = ref.replace('refs/heads/', '');
    const repoData = payload['repository'] as Record<string, unknown>;
    repoFullName = repoData['full_name'] as string;
    const headCommit = payload['head_commit'] as Record<string, unknown> | null;
    commitSha = (headCommit?.['id'] as string) ?? 'unknown';
    const commitMessage = (headCommit?.['message'] as string) ?? '';
    triggerMessage = `Auto-deploy triggered by push to ${branch}\nCommit: ${commitSha}\n${commitMessage}\n`;
  } else if (event === 'pull_request') {
    const action = payload['action'] as string;
    const pr = payload['pull_request'] as Record<string, unknown>;
    const merged = pr['merged'] as boolean;

    // Only trigger on merged PRs
    if (action !== 'closed' || !merged) {
      return c.json({ message: `Ignored pull_request action: ${action}, merged: ${merged}` });
    }

    const base = pr['base'] as Record<string, unknown>;
    branch = base['ref'] as string;
    const repoData = payload['repository'] as Record<string, unknown>;
    repoFullName = repoData['full_name'] as string;
    const mergeCommit = pr['merge_commit_sha'] as string;
    commitSha = mergeCommit ?? 'unknown';
    const prTitle = pr['title'] as string;
    const prNumber = pr['number'] as number;
    triggerMessage = `Auto-deploy triggered by PR #${prNumber} merged into ${branch}\n${prTitle}\nCommit: ${commitSha}\n`;
  } else {
    return c.json({ message: `Ignored event: ${event}` });
  }

  // Find services that match this repo + branch + auto-deploy
  const matchingServices = await db.query.services.findMany({
    where: and(
      eq(services.githubRepo, repoFullName),
      eq(services.githubBranch, branch),
      eq(services.autoDeploy, true),
      isNull(services.deletedAt),
    ),
  });

  if (matchingServices.length === 0) {
    return c.json({ message: 'No matching services for auto-deploy' });
  }

  const results: Array<{ serviceId: string; deploymentId: string; status: string }> = [];

  for (const svc of matchingServices) {
    const [deployment] = await insertReturning(deployments, {
      serviceId: svc.id,
      commitSha,
      status: 'building',
      log: triggerMessage,
      trigger: 'webhook',
      startedAt: new Date(),
    });

    if (!deployment) continue;

    results.push({
      serviceId: svc.id,
      deploymentId: deployment.id,
      status: 'building',
    });
  }

  // Batch update all matched services to 'deploying' status (N+1 fix)
  if (matchingServices.length > 0) {
    const serviceIds = matchingServices.map(s => s.id);
    await db.update(services)
      .set({ status: 'deploying', updatedAt: new Date() })
      .where(inArray(services.id, serviceIds));
  }

  // Queue build pipelines after DB updates are complete
  for (const result of results) {
    const svc = matchingServices.find(s => s.id === result.serviceId);
    if (svc) {
      await enqueueOrRunDeployment({
        deploymentId: result.deploymentId,
        serviceId: svc.id,
        accountId: svc.accountId,
        commitSha,
      });

      eventService.log({
        eventType: EventTypes.DEPLOYMENT_TRIGGERED,
        description: `Auto-deploy triggered by push to ${branch}`,
        resourceType: 'deployment',
        resourceId: svc.id,
        resourceName: svc.name,
        accountId: svc.accountId,
        source: 'webhook',
      });
    }
  }

  return c.json({ message: `Triggered ${results.length} deployment(s)`, results });
});

// --- Authenticated Deployment Routes ---
const authenticatedRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

authenticatedRoutes.use('*', authMiddleware);
authenticatedRoutes.use('*', tenantMiddleware);

// GET / — list deployments for a service (via query param)
authenticatedRoutes.get('/', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.query('serviceId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  if (!serviceId) {
    return c.json({ error: 'serviceId query parameter required' }, 400);
  }

  // Verify the service belongs to this account
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const deploys = await db.query.deployments.findMany({
    where: eq(deployments.serviceId, serviceId),
    orderBy: (d, { desc: descOrder }) => descOrder(d.createdAt),
    limit: 50,
  });

  return c.json(deploys);
});

// GET /:id — deployment details
authenticatedRoutes.get('/:id', async (c) => {
  const accountId = c.get('accountId');
  const deploymentId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { service: true },
  });

  if (!deployment) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  // Verify account access
  if (deployment.service.accountId !== accountId) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  return c.json(deployment);
});

// POST /trigger — manually trigger a deployment for a service
authenticatedRoutes.post('/trigger', requireMember, requireActiveSubscription, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = (await c.req.json()) as { serviceId: string };
  const { serviceId } = body;

  if (!serviceId) {
    return c.json({ error: 'serviceId is required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (!svc.githubRepo || !svc.githubBranch) {
    return c.json({ error: 'Service has no GitHub repository configured' }, 400);
  }

  // Prevent duplicate deployments
  if (svc.status === 'deploying') {
    return c.json({ error: 'Service is already deploying. Wait for the current deployment to finish.' }, 409);
  }

  // Per-account concurrent deployment limit (prevent resource exhaustion)
  const MAX_CONCURRENT_DEPLOYS = 5;
  const activeDeploys = await db.query.services.findMany({
    where: and(
      eq(services.accountId, accountId),
      eq(services.status, 'deploying'),
      isNull(services.deletedAt),
    ),
    columns: { id: true },
  });
  if (activeDeploys.length >= MAX_CONCURRENT_DEPLOYS) {
    return c.json({
      error: `Maximum ${MAX_CONCURRENT_DEPLOYS} concurrent deployments per account. Wait for active deployments to finish.`,
    }, 429);
  }

  // Create deployment record
  const [deployment] = await insertReturning(deployments, {
    serviceId: svc.id,
    status: 'building',
    log: `Manual deploy triggered by ${user.email}\n`,
    trigger: 'manual',
    startedAt: new Date(),
  });

  if (!deployment) {
    return c.json({ error: 'Failed to create deployment record' }, 500);
  }

  // Update service status (optimistic guard to prevent race conditions)
  await db
    .update(services)
    .set({ status: 'deploying', updatedAt: new Date() })
    .where(and(eq(services.id, svc.id), eq(services.status, svc.status as string)));

  // Queue build pipeline via BullMQ (or run in-process if Valkey unavailable)
  await enqueueOrRunDeployment({
    deploymentId: deployment.id,
    serviceId: svc.id,
    accountId: svc.accountId,
    commitSha: null,
  });

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.DEPLOYMENT_TRIGGERED,
    description: `Triggered deployment for '${svc.name}'`,
    resourceType: 'deployment',
    resourceId: deployment.id,
    resourceName: svc.name,
  });

  return c.json({ message: 'Deployment triggered', deploymentId: deployment.id }, 202);
});

// POST /:id/rollback — rollback to a previous deployment
authenticatedRoutes.post('/:id/rollback', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const deploymentId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { service: true },
  });

  if (!deployment) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  if (deployment.service.accountId !== accountId) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  if (!deployment.imageTag) {
    return c.json({ error: 'Deployment has no image tag to rollback to' }, 400);
  }

  const svc = deployment.service;

  // Create new deployment record for the rollback
  const [rollbackDeploy] = await insertReturning(deployments, {
    serviceId: svc.id,
    commitSha: deployment.commitSha,
    imageTag: deployment.imageTag,
    status: 'deploying',
    log: `Rollback to deployment ${deploymentId} (image: ${deployment.imageTag})\n`,
  });

  if (!rollbackDeploy) {
    return c.json({ error: 'Failed to create rollback record' }, 500);
  }

  // Update Docker service with the old image
  if (svc.dockerServiceId) {
    try {
      await dockerService.updateService(svc.dockerServiceId, {
        image: deployment.imageTag,
      });

      await db
        .update(deployments)
        .set({ status: 'succeeded', log: rollbackDeploy.log + 'Rollback succeeded.\n' })
        .where(eq(deployments.id, rollbackDeploy.id));

      await db
        .update(services)
        .set({ image: deployment.imageTag, status: 'running', updatedAt: new Date() })
        .where(eq(services.id, svc.id));
    } catch (err) {
      await db
        .update(deployments)
        .set({ status: 'failed', log: rollbackDeploy.log + `Rollback failed: ${String(err)}\n` })
        .where(eq(deployments.id, rollbackDeploy.id));

      await db
        .update(services)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(services.id, svc.id));

      return c.json({ error: 'Rollback failed' }, 500);
    }
  }

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.DEPLOYMENT_ROLLED_BACK,
    description: `Rolled back deployment for '${svc.name}'`,
    resourceType: 'deployment',
    resourceId: rollbackDeploy.id,
    resourceName: svc.name,
  });

  return c.json({ message: 'Rollback succeeded', deploymentId: rollbackDeploy.id });
});

// PATCH /:id/notes — update deployment notes/annotations
authenticatedRoutes.patch('/:id/notes', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const deploymentId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = (await c.req.json()) as { notes: string };
  if (typeof body.notes !== 'string' || body.notes.length > 500) {
    return c.json({ error: 'Notes must be a string (max 500 chars)' }, 400);
  }

  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { service: true },
  });

  if (!deployment || deployment.service.accountId !== accountId) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  await db.update(deployments)
    .set({ notes: body.notes })
    .where(eq(deployments.id, deploymentId));

  return c.json({ message: 'Notes updated' });
});

// GET /:id/logs — get deployment logs
authenticatedRoutes.get('/:id/logs', async (c) => {
  const accountId = c.get('accountId');
  const deploymentId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { service: true },
  });

  if (!deployment) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  if (deployment.service.accountId !== accountId) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  // Check if build is still running
  const liveBuild = buildService.getBuildStatus(deploymentId);
  const log = liveBuild?.log ?? deployment.log ?? '';

  return c.json({ log, status: liveBuild?.status ?? deployment.status });
});

// --- GitHub Manifest (for one-click deploy) ---

// GET /github/manifest — fetch fleet.json from a public (or private) GitHub repo
authenticatedRoutes.get('/github/manifest', async (c) => {
  const user = c.get('user');
  const repo = c.req.query('repo');
  const branch = c.req.query('branch');

  if (!repo || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repo)) {
    return c.json({ error: 'Invalid repo format. Expected owner/repo' }, 400);
  }

  // Try to get user's GitHub token for private repos
  let githubToken: string | null = null;
  try {
    const oauth = await db.query.oauthProviders.findFirst({
      where: and(
        eq(oauthProviders.userId, user.userId),
        eq(oauthProviders.provider, 'github'),
      ),
    });
    if (oauth?.accessToken) {
      githubToken = decrypt(oauth.accessToken);
    }
  } catch {
    // No GitHub token — will try public access
  }

  // Resolve branch: URL param → default branch via GitHub API
  let targetBranch = branch;
  if (!targetBranch) {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Fleet-Deploy',
      };
      if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

      const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
      if (repoRes.ok) {
        const repoData = await repoRes.json() as { default_branch?: string };
        targetBranch = repoData.default_branch ?? 'main';
      } else {
        targetBranch = 'main';
      }
    } catch {
      targetBranch = 'main';
    }
  }

  // Fetch fleet.json from the repo
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${targetBranch}/fleet.json`;
    const headers: Record<string, string> = { 'User-Agent': 'Fleet-Deploy' };
    if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

    const res = await fetch(rawUrl, { headers, signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      // No fleet.json — that's fine, return null manifest with repo info
      return c.json({ manifest: null, branch: targetBranch, repo });
    }

    const text = await res.text();
    // Guard against absurdly large manifests
    if (text.length > 50_000) {
      return c.json({ error: 'fleet.json too large (max 50 KB)' }, 400);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return c.json({ error: 'fleet.json contains invalid JSON' }, 400);
    }

    const result = fleetManifestSchema.safeParse(parsed);
    if (!result.success) {
      return c.json({
        error: 'fleet.json validation failed',
        details: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      }, 400);
    }

    return c.json({ manifest: result.data, branch: targetBranch, repo });
  } catch (err) {
    logger.error({ err, repo }, 'Failed to fetch fleet.json');
    return c.json({ manifest: null, branch: targetBranch, repo });
  }
});

// --- GitHub Repo Management (authenticated) ---

// GET /github/status — check if user has GitHub connected
authenticatedRoutes.get('/github/status', async (c) => {
  const user = c.get('user');

  const oauth = await db.query.oauthProviders.findFirst({
    where: and(
      eq(oauthProviders.userId, user.userId),
      eq(oauthProviders.provider, 'github'),
    ),
  });

  return c.json({ connected: !!oauth });
});

// GET /github/repos — list user's GitHub repositories
authenticatedRoutes.get('/github/repos', async (c) => {
  const user = c.get('user');

  // Get user's GitHub OAuth token
  const oauth = await db.query.oauthProviders.findFirst({
    where: and(
      eq(oauthProviders.userId, user.userId),
      eq(oauthProviders.provider, 'github'),
    ),
  });

  if (!oauth?.accessToken) {
    return c.json({ error: 'GitHub account not connected. Please link your GitHub account in settings.' }, 400);
  }

  try {
    const token = decrypt(oauth.accessToken);
    const repos = await githubService.getRepositories(token);
    return c.json(repos);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch GitHub repos');
    return c.json({ error: 'Failed to fetch repositories from GitHub' }, 500);
  }
});

// GET /github/repos/:owner/:repo/branches — list branches
authenticatedRoutes.get('/github/repos/:owner/:repo/branches', async (c) => {
  const user = c.get('user');
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');

  const oauth = await db.query.oauthProviders.findFirst({
    where: and(
      eq(oauthProviders.userId, user.userId),
      eq(oauthProviders.provider, 'github'),
    ),
  });

  if (!oauth?.accessToken) {
    return c.json({ error: 'GitHub account not connected' }, 400);
  }

  try {
    const token = decrypt(oauth.accessToken);
    const branches = await githubService.getBranches(token, owner, repo);
    return c.json(branches);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch branches');
    return c.json({ error: 'Failed to fetch branches from GitHub' }, 500);
  }
});

// --- Combine Routes ---
const deploymentRoutes = new Hono();
deploymentRoutes.route('/', webhookRoutes);
deploymentRoutes.route('/', authenticatedRoutes);

export default deploymentRoutes;
