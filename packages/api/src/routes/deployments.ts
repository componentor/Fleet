import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, services, deployments, subscriptions, accounts, oauthProviders, insertReturning, eq, and, isNull, inArray } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { githubService, getGitHubConfig } from '../services/github.service.js';
import { buildService } from '../services/build.service.js';
import { orchestrator } from '../services/orchestrator.js';
import { getRegistryAuthForImage } from '../services/docker.service.js';
import { requireMember } from '../middleware/rbac.js';
import { requireActiveSubscription } from '../middleware/subscription.js';
import { getDeploymentQueue, isQueueAvailable } from '../services/queue.service.js';
import type { DeploymentJobData } from '../workers/deployment.worker.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { decrypt } from '../services/crypto.service.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity, noSecurity } from './_schemas.js';

// ── siglar.json manifest schema ───────────────────────────────────────────────
const fleetManifestSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().url().optional(),
  website: z.string().url().optional(),
  env: z.record(z.string(), z.union([
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
export async function enqueueOrRunDeployment(data: DeploymentJobData) {
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
        logToErrorTable({ level: 'error', message: `processDeploymentInline failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'deployments', operation: 'processDeploymentInline' } });
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

// ── Schemas ──

const deploymentIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Deployment ID' }),
});

const ownerRepoParamSchema = z.object({
  owner: z.string().openapi({ description: 'GitHub repository owner' }),
  repo: z.string().openapi({ description: 'GitHub repository name' }),
});

const serviceIdQuerySchema = z.object({
  serviceId: z.string().optional().openapi({ description: 'Service ID to filter by' }),
});

const manifestQuerySchema = z.object({
  repo: z.string().optional().openapi({ description: 'GitHub repo in owner/repo format' }),
  branch: z.string().optional().openapi({ description: 'Branch name' }),
});

const triggerDeploySchema = z.object({
  serviceId: z.string(),
}).openapi('TriggerDeployRequest');

const updateNotesSchema = z.object({
  notes: z.string().max(500),
}).openapi('UpdateDeploymentNotesRequest');

// --- GitHub Webhook (unauthenticated, signature-verified) ---
const webhookRoutes = new OpenAPIHono();

const githubWebhookRoute = createRoute({
  method: 'post',
  path: '/github/webhook',
  tags: ['Deployments'],
  summary: 'GitHub webhook for auto-deploy (signature-verified)',
  security: noSecurity,
  responses: {
    200: jsonContent(z.any(), 'Webhook processed'),
    ...standardErrors,
  },
});

// In-memory set for webhook delivery deduplication (prevents duplicate deploys from GitHub retries)
const recentDeliveryIds = new Set<string>();
const DELIVERY_TTL_MS = 10 * 60 * 1000; // 10 minutes

function recordDelivery(deliveryId: string) {
  recentDeliveryIds.add(deliveryId);
  setTimeout(() => recentDeliveryIds.delete(deliveryId), DELIVERY_TTL_MS);
}

// Per-repo rate limiting: max 5 webhook-triggered deploys per repo per minute
const repoWebhookCounts = new Map<string, { count: number; resetAt: number }>();
const WEBHOOK_RATE_LIMIT = 5;
const WEBHOOK_RATE_WINDOW_MS = 60_000;

function checkRepoRateLimit(repo: string): boolean {
  const now = Date.now();
  const entry = repoWebhookCounts.get(repo);
  if (!entry || now >= entry.resetAt) {
    repoWebhookCounts.set(repo, { count: 1, resetAt: now + WEBHOOK_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= WEBHOOK_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Commit message patterns that skip deployment
const SKIP_DEPLOY_PATTERNS = [
  /\[skip deploy\]/i,
  /\[deploy skip\]/i,
  /\[skip cd\]/i,
  /\[no deploy\]/i,
  /\[ci skip\]/i,
];

function shouldSkipDeploy(commitMessage: string): boolean {
  return SKIP_DEPLOY_PATTERNS.some(pattern => pattern.test(commitMessage));
}

webhookRoutes.openapi(githubWebhookRoute, (async (c: any) => {
  const ghConfig = await getGitHubConfig();
  const webhookSecret = ghConfig.webhookSecret;
  if (!webhookSecret) {
    return c.json({ error: 'Webhook secret not configured' }, 500);
  }

  const signature = c.req.header('X-Hub-Signature-256');
  if (!signature) {
    logger.warn({ path: c.req.path }, 'GitHub webhook: missing signature header');
    return c.json({ error: 'Missing signature' }, 401);
  }

  const rawBody = await c.req.text();

  if (!githubService.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    logger.warn({ path: c.req.path, ip: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') }, 'GitHub webhook: invalid signature — possible attack or misconfigured secret');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // Idempotency: deduplicate GitHub delivery retries
  const deliveryId = c.req.header('X-GitHub-Delivery');
  if (deliveryId) {
    if (recentDeliveryIds.has(deliveryId)) {
      logger.info({ deliveryId }, 'GitHub webhook: duplicate delivery — skipping');
      return c.json({ message: 'Duplicate delivery — already processed' });
    }
    recordDelivery(deliveryId);
  }

  const event = c.req.header('X-GitHub-Event');
  const payload = JSON.parse(rawBody) as Record<string, unknown>;

  let branch: string;
  let repoFullName: string;
  let commitSha: string;
  let commitMessage = '';
  let triggerMessage: string;

  if (event === 'push') {
    const ref = payload['ref'] as string; // "refs/heads/main"

    // Ignore tag pushes
    if (!ref.startsWith('refs/heads/')) {
      return c.json({ message: `Ignored non-branch ref: ${ref}` });
    }

    // Ignore branch deletion events (deleted flag or null head_commit)
    if (payload['deleted'] === true) {
      return c.json({ message: 'Ignored branch deletion event' });
    }

    branch = ref.replace('refs/heads/', '');
    const repoData = payload['repository'] as Record<string, unknown>;
    repoFullName = repoData['full_name'] as string;
    const headCommit = payload['head_commit'] as Record<string, unknown> | null;
    commitSha = (headCommit?.['id'] as string) ?? 'unknown';
    commitMessage = (headCommit?.['message'] as string) ?? '';
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
    commitMessage = prTitle;
    triggerMessage = `Auto-deploy triggered by PR #${prNumber} merged into ${branch}\n${prTitle}\nCommit: ${commitSha}\n`;
  } else if (event === 'ping') {
    return c.json({ message: 'Pong — webhook configured successfully' });
  } else {
    return c.json({ message: `Ignored event: ${event}` });
  }

  // Skip deploy if commit message contains skip pattern
  if (shouldSkipDeploy(commitMessage)) {
    logger.info({ repo: repoFullName, commitSha, commitMessage }, 'Skipping deploy due to commit message flag');
    return c.json({ message: 'Deploy skipped due to commit message flag', commitSha });
  }

  // Per-repo rate limiting
  if (!checkRepoRateLimit(repoFullName)) {
    logger.warn({ repo: repoFullName }, 'GitHub webhook rate limit exceeded');
    return c.json({ error: `Rate limit exceeded for ${repoFullName} — max ${WEBHOOK_RATE_LIMIT} deploys per minute` }, 429);
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

  // Filter out services whose accounts are suspended or deleted
  const accountIds = [...new Set(matchingServices.map(s => s.accountId))];
  const suspendedAccounts = new Set<string>();
  for (const accId of accountIds) {
    const acc = await db.query.accounts.findFirst({ where: eq(accounts.id, accId), columns: { id: true, status: true } });
    if (acc?.status === 'suspended' || acc?.status === 'deleted') {
      suspendedAccounts.add(accId);
    }
  }
  const eligibleServices = matchingServices.filter(s => !suspendedAccounts.has(s.accountId));

  if (eligibleServices.length === 0) {
    return c.json({ message: 'No eligible services for auto-deploy (accounts suspended or inactive)' });
  }

  // Skip services that are already deploying (prevent queuing on top of active builds)
  const deployableServices = eligibleServices.filter(s => s.status !== 'deploying');
  if (deployableServices.length === 0) {
    return c.json({ message: 'All matching services are already deploying — skipping' });
  }

  const results: Array<{ serviceId: string; deploymentId: string; status: string }> = [];

  for (const svc of deployableServices) {
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

  // Batch update all matched services to 'deploying' status
  if (deployableServices.length > 0) {
    const serviceIds = deployableServices.map(s => s.id);
    await db.update(services)
      .set({ status: 'deploying', updatedAt: new Date() })
      .where(inArray(services.id, serviceIds));
  }

  // Queue build pipelines after DB updates are complete
  for (const result of results) {
    const svc = deployableServices.find(s => s.id === result.serviceId);
    if (svc) {
      await enqueueOrRunDeployment({
        deploymentId: result.deploymentId,
        serviceId: svc.id,
        accountId: svc.accountId,
        commitSha,
      });

      eventService.log({
        eventType: EventTypes.DEPLOYMENT_TRIGGERED,
        description: `Auto-deploy triggered for '${svc.name}' by ${event === 'push' ? `push to ${branch}` : `PR merge into ${branch}`}`,
        resourceType: 'deployment',
        resourceId: svc.id,
        resourceName: svc.name,
        accountId: svc.accountId,
        source: 'webhook',
      });
    }
  }

  logger.info({ repo: repoFullName, branch, event, deployments: results.length, commitSha }, 'GitHub webhook processed');
  return c.json({ message: `Triggered ${results.length} deployment(s)`, results });
}) as any);

// --- Registry Push Webhook (unauthenticated, token-verified) ---

const registryWebhookRoute = createRoute({
  method: 'post',
  path: '/registry/webhook/{serviceId}',
  tags: ['Deployments'],
  summary: 'Registry push webhook for auto-deploy (token-verified)',
  security: noSecurity,
  request: {
    params: z.object({ serviceId: z.string().uuid() }),
    query: z.object({ token: z.string().max(128).optional() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Webhook processed'),
    ...standardErrors,
  },
});

webhookRoutes.openapi(registryWebhookRoute, (async (c: any) => {
  const { serviceId } = c.req.valid('param');
  const { token } = c.req.valid('query');

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), isNull(services.deletedAt)),
  });

  if (!svc || !svc.registryWebhookSecret) {
    return c.json({ error: 'Service not found or webhook not configured' }, 404);
  }

  // Verify webhook authenticity via query token or HMAC signature
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const rawBody = await c.req.text();

  // Limit body size to prevent abuse (1MB max)
  if (rawBody.length > 1_048_576) {
    return c.json({ error: 'Request body too large' }, 413);
  }

  /** Timing-safe string comparison to prevent timing attacks */
  function safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  let verified = false;

  // Method 1: Token in query string (timing-safe comparison)
  if (token && svc.registryWebhookSecret && token.length > 0) {
    verified = safeCompare(token, svc.registryWebhookSecret);
  }

  // Method 2: Docker Hub X-Hub-Signature
  if (!verified) {
    const hubSig = c.req.header('X-Hub-Signature');
    if (hubSig) {
      const expected = 'sha256=' + createHmac('sha256', svc.registryWebhookSecret).update(rawBody).digest('hex');
      verified = safeCompare(hubSig, expected);
    }
  }

  // Method 3: GitHub/GHCR X-Hub-Signature-256
  if (!verified) {
    const ghSig = c.req.header('X-Hub-Signature-256');
    if (ghSig) {
      const expected = 'sha256=' + createHmac('sha256', svc.registryWebhookSecret).update(rawBody).digest('hex');
      verified = safeCompare(ghSig, expected);
    }
  }

  if (!verified) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Check account status
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, svc.accountId),
    columns: { id: true, status: true },
  });
  if (!account || account.status === 'suspended' || account.status === 'deleted') {
    return c.json({ error: 'Account suspended or deleted' }, 403);
  }

  // Create deployment record
  const [deployment] = await insertReturning(deployments, {
    serviceId: svc.id,
    status: 'deploying',
    imageTag: svc.image,
    trigger: 'webhook',
    log: `Registry push webhook received\n`,
    startedAt: new Date(),
  });

  if (!deployment) {
    return c.json({ error: 'Failed to create deployment record' }, 500);
  }

  // Update Docker service with force pull
  if (svc.dockerServiceId) {
    try {
      const registryAuth = await getRegistryAuthForImage(svc.accountId, svc.image);
      await orchestrator.updateService(svc.dockerServiceId, {
        image: svc.image,
      }, registryAuth);

      await db.update(deployments)
        .set({ status: 'succeeded', completedAt: new Date(), log: deployment.log + 'Image updated successfully.\n' })
        .where(eq(deployments.id, deployment.id));

      await db.update(services)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(services.id, svc.id));
    } catch (err) {
      logger.error({ err, serviceId: svc.id }, 'Registry webhook deploy failed');
      logToErrorTable({ level: 'error', message: `Registry webhook deploy failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'deployments', operation: 'registry-webhook-deploy' } });
      await db.update(deployments)
        .set({ status: 'failed', completedAt: new Date(), log: deployment.log + `Deploy failed: ${String(err)}\n` })
        .where(eq(deployments.id, deployment.id));

      await db.update(services)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(services.id, svc.id));
    }
  }

  eventService.log({
    eventType: EventTypes.DEPLOYMENT_TRIGGERED,
    description: `Registry webhook triggered redeploy for '${svc.name}'`,
    resourceType: 'deployment',
    resourceId: deployment.id,
    resourceName: svc.name,
    accountId: svc.accountId,
    source: 'webhook',
  });

  return c.json({ message: 'Deployment triggered', deploymentId: deployment.id });
}) as any);

// --- Authenticated Deployment Routes ---
const authenticatedRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

authenticatedRoutes.use('*', authMiddleware);
authenticatedRoutes.use('*', tenantMiddleware);

// ── Route: GET / — list deployments for a service ──

const listDeploymentsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Deployments'],
  summary: 'List deployments for a service',
  security: bearerSecurity,
  request: {
    query: serviceIdQuerySchema,
  },
  responses: {
    200: jsonContent(z.array(z.any()), 'List of deployments'),
    ...standardErrors,
  },
});

authenticatedRoutes.openapi(listDeploymentsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('query');

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
}) as any);

// ── Route: GET /:id — deployment details ──

const getDeploymentRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Deployments'],
  summary: 'Get deployment details',
  security: bearerSecurity,
  request: {
    params: deploymentIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Deployment details'),
    ...standardErrors,
  },
});

authenticatedRoutes.openapi(getDeploymentRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: deploymentId } = c.req.valid('param');

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
}) as any);

// ── Route: POST /trigger — manually trigger a deployment ──

const triggerDeployRoute = createRoute({
  method: 'post',
  path: '/trigger',
  tags: ['Deployments'],
  summary: 'Manually trigger a deployment for a service',
  security: bearerSecurity,
  request: {
    body: jsonBody(triggerDeploySchema),
  },
  responses: {
    202: jsonContent(z.object({ message: z.string(), deploymentId: z.string() }), 'Deployment triggered'),
    ...standardErrors,
    409: jsonContent(errorResponseSchema, 'Service already deploying'),
    429: jsonContent(errorResponseSchema, 'Too many concurrent deployments'),
  },
  middleware: [requireMember, requireActiveSubscription] as const,
});

authenticatedRoutes.openapi(triggerDeployRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { serviceId } = c.req.valid('json');

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
}) as any);

// ── Route: POST /:id/rollback — rollback to a previous deployment ──

const rollbackRoute = createRoute({
  method: 'post',
  path: '/{id}/rollback',
  tags: ['Deployments'],
  summary: 'Rollback to a previous deployment',
  security: bearerSecurity,
  request: {
    params: deploymentIdParamSchema,
  },
  responses: {
    200: jsonContent(z.object({ message: z.string(), deploymentId: z.string() }), 'Rollback succeeded'),
    ...standardErrors,
  },
  middleware: [requireMember] as const,
});

authenticatedRoutes.openapi(rollbackRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: deploymentId } = c.req.valid('param');

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
      const rollbackAuth = await getRegistryAuthForImage(accountId, deployment.imageTag);
      await orchestrator.updateService(svc.dockerServiceId, {
        image: deployment.imageTag,
      }, rollbackAuth);

      await db
        .update(deployments)
        .set({ status: 'succeeded', log: rollbackDeploy.log + 'Rollback succeeded.\n' })
        .where(eq(deployments.id, rollbackDeploy.id));

      await db
        .update(services)
        .set({ image: deployment.imageTag, status: 'running', updatedAt: new Date() })
        .where(eq(services.id, svc.id));
    } catch (err) {
      logger.error({ err, serviceId: svc.id }, 'Deployment rollback failed');
      logToErrorTable({ level: 'error', message: `Deployment rollback failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'deployments', operation: 'deployment-rollback' } });
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
}) as any);

// ── Route: PATCH /:id/notes — update deployment notes ──

const updateNotesRoute = createRoute({
  method: 'patch',
  path: '/{id}/notes',
  tags: ['Deployments'],
  summary: 'Update deployment notes/annotations',
  security: bearerSecurity,
  request: {
    params: deploymentIdParamSchema,
    body: jsonBody(updateNotesSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Notes updated'),
    ...standardErrors,
  },
  middleware: [requireMember] as const,
});

authenticatedRoutes.openapi(updateNotesRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: deploymentId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { notes } = c.req.valid('json');

  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { service: true },
  });

  if (!deployment || deployment.service.accountId !== accountId) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  await db.update(deployments)
    .set({ notes })
    .where(eq(deployments.id, deploymentId));

  return c.json({ message: 'Notes updated' });
}) as any);

// ── Route: GET /:id/logs — get deployment logs ──

const getLogsRoute = createRoute({
  method: 'get',
  path: '/{id}/logs',
  tags: ['Deployments'],
  summary: 'Get deployment logs',
  security: bearerSecurity,
  request: {
    params: deploymentIdParamSchema,
  },
  responses: {
    200: jsonContent(z.object({ log: z.string(), status: z.string() }), 'Deployment logs'),
    ...standardErrors,
  },
});

authenticatedRoutes.openapi(getLogsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: deploymentId } = c.req.valid('param');

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
}) as any);

// --- GitHub Manifest (for one-click deploy) ---

const getManifestRoute = createRoute({
  method: 'get',
  path: '/github/manifest',
  tags: ['Deployments'],
  summary: 'Fetch siglar.json from a GitHub repo',
  security: bearerSecurity,
  request: {
    query: manifestQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Manifest data'),
    ...standardErrors,
  },
});

authenticatedRoutes.openapi(getManifestRoute, (async (c: any) => {
  const user = c.get('user');
  const { repo, branch } = c.req.valid('query');

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

  // Resolve branch: URL param -> default branch via GitHub API
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

  // Fetch siglar.json from the repo
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${targetBranch}/siglar.json`;
    const headers: Record<string, string> = { 'User-Agent': 'Fleet-Deploy' };
    if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

    const res = await fetch(rawUrl, { headers, signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      // No siglar.json — that's fine, return null manifest with repo info
      return c.json({ manifest: null, branch: targetBranch, repo });
    }

    const text = await res.text();
    // Guard against absurdly large manifests
    if (text.length > 50_000) {
      return c.json({ error: 'siglar.json too large (max 50 KB)' }, 400);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return c.json({ error: 'siglar.json contains invalid JSON' }, 400);
    }

    const result = fleetManifestSchema.safeParse(parsed);
    if (!result.success) {
      return c.json({
        error: 'siglar.json validation failed',
        details: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      }, 400);
    }

    return c.json({ manifest: result.data, branch: targetBranch, repo });
  } catch (err) {
    logger.error({ err, repo }, 'Failed to fetch siglar.json');
    logToErrorTable({ level: 'warn', message: `siglar.json fetch failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'deployments', operation: 'fleet-json-fetch' } });
    return c.json({ manifest: null, branch: targetBranch, repo });
  }
}) as any);

// --- GitHub Repo Management (authenticated) ---

const getGithubStatusRoute = createRoute({
  method: 'get',
  path: '/github/status',
  tags: ['Deployments'],
  summary: 'Check if user has GitHub connected',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({ connected: z.boolean() }), 'GitHub connection status'),
    ...standardErrors,
  },
});

authenticatedRoutes.openapi(getGithubStatusRoute, (async (c: any) => {
  const user = c.get('user');

  const oauth = await db.query.oauthProviders.findFirst({
    where: and(
      eq(oauthProviders.userId, user.userId),
      eq(oauthProviders.provider, 'github'),
    ),
  });

  return c.json({ connected: !!oauth });
}) as any);

// ── Route: GET /github/repos — list user's GitHub repos ──

const listGithubReposRoute = createRoute({
  method: 'get',
  path: '/github/repos',
  tags: ['Deployments'],
  summary: "List user's GitHub repositories",
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'List of GitHub repositories'),
    ...standardErrors,
  },
});

authenticatedRoutes.openapi(listGithubReposRoute, (async (c: any) => {
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
    logToErrorTable({ level: 'error', message: `GitHub repo list failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'deployments', operation: 'github-repo-list' } });
    return c.json({ error: 'Failed to fetch repositories from GitHub' }, 500);
  }
}) as any);

// ── Route: GET /github/repos/:owner/:repo/branches — list branches ──

const listBranchesRoute = createRoute({
  method: 'get',
  path: '/github/repos/{owner}/{repo}/branches',
  tags: ['Deployments'],
  summary: 'List branches for a GitHub repository',
  security: bearerSecurity,
  request: {
    params: ownerRepoParamSchema,
  },
  responses: {
    200: jsonContent(z.array(z.any()), 'List of branches'),
    ...standardErrors,
  },
});

authenticatedRoutes.openapi(listBranchesRoute, (async (c: any) => {
  const user = c.get('user');
  const { owner, repo } = c.req.valid('param');

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
    logToErrorTable({ level: 'error', message: `GitHub branch list failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'deployments', operation: 'github-branch-list' } });
    return c.json({ error: 'Failed to fetch branches from GitHub' }, 500);
  }
}) as any);

// --- Combine Routes ---
const deploymentRoutes = new OpenAPIHono();
deploymentRoutes.route('/', webhookRoutes);
deploymentRoutes.route('/', authenticatedRoutes);

export default deploymentRoutes;
