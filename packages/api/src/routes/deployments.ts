import { Hono } from 'hono';
import { db, services, deployments, oauthProviders, insertReturning, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { githubService } from '../services/github.service.js';
import { buildService } from '../services/build.service.js';
import { dockerService } from '../services/docker.service.js';
import { requireMember } from '../middleware/rbac.js';
import { getDeploymentQueue, isQueueAvailable } from '../services/queue.service.js';
import type { DeploymentJobData } from '../workers/deployment.worker.js';
import { logger } from '../services/logger.js';

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
      processDeploymentInline(data).catch((err) =>
        logger.error({ err, deploymentId: data.deploymentId }, `Build failed for deployment ${data.deploymentId}`),
      ),
    );
  }
}

// --- GitHub Webhook (unauthenticated, signature-verified) ---
const webhookRoutes = new Hono();

webhookRoutes.post('/github/webhook', async (c) => {
  const webhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];
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
  if (event !== 'push') {
    return c.json({ message: `Ignored event: ${event}` });
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const ref = payload['ref'] as string; // "refs/heads/main"
  const branch = ref.replace('refs/heads/', '');
  const repoData = payload['repository'] as Record<string, unknown>;
  const repoFullName = repoData['full_name'] as string;
  const headCommit = payload['head_commit'] as Record<string, unknown> | null;
  const commitSha = (headCommit?.['id'] as string) ?? 'unknown';
  const commitMessage = (headCommit?.['message'] as string) ?? '';

  // Find services that match this repo + branch + auto-deploy
  const matchingServices = await db.query.services.findMany({
    where: and(
      eq(services.githubRepo, repoFullName),
      eq(services.githubBranch, branch),
      eq(services.autoDeploy, true),
    ),
  });

  if (matchingServices.length === 0) {
    return c.json({ message: 'No matching services for auto-deploy' });
  }

  const results: Array<{ serviceId: string; deploymentId: string; status: string }> = [];

  for (const svc of matchingServices) {
    // Create deployment record
    const [deployment] = await insertReturning(deployments, {
      serviceId: svc.id,
      commitSha,
      status: 'building',
      log: `Auto-deploy triggered by push to ${branch}\nCommit: ${commitSha}\n${commitMessage}\n`,
    });

    if (!deployment) continue;

    // Update service status
    await db
      .update(services)
      .set({ status: 'deploying', updatedAt: new Date() })
      .where(eq(services.id, svc.id));

    // Queue build pipeline via BullMQ (or run in-process if Valkey unavailable)
    await enqueueOrRunDeployment({
      deploymentId: deployment.id,
      serviceId: svc.id,
      accountId: svc.accountId,
      commitSha,
    });

    results.push({
      serviceId: svc.id,
      deploymentId: deployment.id,
      status: 'building',
    });
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
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
authenticatedRoutes.post('/trigger', requireMember, async (c) => {
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
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (!svc.githubRepo || !svc.githubBranch) {
    return c.json({ error: 'Service has no GitHub repository configured' }, 400);
  }

  // Create deployment record
  const [deployment] = await insertReturning(deployments, {
    serviceId: svc.id,
    status: 'building',
    log: `Manual deploy triggered by ${user.email}\n`,
  });

  if (!deployment) {
    return c.json({ error: 'Failed to create deployment record' }, 500);
  }

  // Update service status
  await db
    .update(services)
    .set({ status: 'deploying', updatedAt: new Date() })
    .where(eq(services.id, svc.id));

  // Queue build pipeline via BullMQ (or run in-process if Valkey unavailable)
  await enqueueOrRunDeployment({
    deploymentId: deployment.id,
    serviceId: svc.id,
    accountId: svc.accountId,
    commitSha: null,
  });

  return c.json({ message: 'Deployment triggered', deploymentId: deployment.id }, 201);
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

  return c.json({ message: 'Rollback succeeded', deploymentId: rollbackDeploy.id });
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

// --- GitHub Repo Management (authenticated) ---

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
    const repos = await githubService.getRepositories(oauth.accessToken);
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
    const branches = await githubService.getBranches(oauth.accessToken, owner, repo);
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
