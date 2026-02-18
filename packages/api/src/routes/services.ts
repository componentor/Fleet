import { Hono } from 'hono';
import { z } from 'zod';
import { db, services, deployments, oauthProviders, insertReturning, updateReturning, eq, and, not, isNull } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { dockerService } from '../services/docker.service.js';
import { githubService } from '../services/github.service.js';
import { requireMember } from '../middleware/rbac.js';
import { requireActiveSubscription } from '../middleware/subscription.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { logger } from '../services/logger.js';
import { decrypt } from '../services/crypto.service.js';

const serviceRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

serviceRoutes.use('*', authMiddleware);
serviceRoutes.use('*', tenantMiddleware);

function buildTraefikLabels(
  serviceName: string,
  domain: string | null,
  sslEnabled: boolean,
): Record<string, string> {
  if (!domain) return { 'traefik.enable': 'false' };

  const routerName = serviceName.replace(/[^a-zA-Z0-9]/g, '-');

  const labels: Record<string, string> = {
    'traefik.enable': 'true',
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${domain}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'websecure',
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]: '80',
  };

  if (sslEnabled) {
    labels[`traefik.http.routers.${routerName}.tls`] = 'true';
    labels[`traefik.http.routers.${routerName}.tls.certresolver`] = 'letsencrypt';
  }

  return labels;
}

// GET / — list services for the current account
serviceRoutes.get('/', cache(30), async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const result = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
    orderBy: (s, { desc }) => desc(s.createdAt),
  });

  return c.json(result);
});

// POST / — deploy a new service
const createServiceSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-zA-Z0-9]([a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/, 'Service name must contain only letters, numbers, hyphens, dots, and underscores'),
  image: z.string().min(1),
  replicas: z.number().int().min(1).max(100).default(1),
  env: z.record(z.string()).default({}),
  ports: z.array(z.object({
    target: z.number().int().min(1).max(65535),
    published: z.number().int().min(1).max(65535).optional(),
    protocol: z.enum(['tcp', 'udp']).default('tcp'),
  })).default([]),
  volumes: z.array(z.object({
    source: z.string(),
    target: z.string(),
    readonly: z.boolean().default(false),
  })).default([]),
  domain: z.string().regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/).nullable().optional(),
  sslEnabled: z.boolean().default(true),
  nodeConstraint: z.string().nullable().optional(),
  placementConstraints: z.array(z.string()).default([]),
  updateParallelism: z.number().int().min(1).default(1),
  updateDelay: z.string().max(20).regex(/^\d+(\.\d+)?(ns|us|ms|s|m|h)$/, 'Invalid duration format').default('10s'),
  rollbackOnFailure: z.boolean().default(true),
  healthCheck: z.object({
    cmd: z.string().max(1000),
    interval: z.number().int().min(1),
    timeout: z.number().int().min(1),
    retries: z.number().int().min(1).max(20),
  }).nullable().optional(),
  githubRepo: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'Must be in owner/repo format').nullable().optional(),
  githubBranch: z.string().nullable().optional(),
  autoDeploy: z.boolean().default(false),
  sourceType: z.enum(['docker', 'github', 'upload', 'marketplace']).nullable().optional(),
  sourcePath: z.string().nullable().optional(),
});

serviceRoutes.post('/', requireMember, requireActiveSubscription, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = createServiceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const data = parsed.data;

  // Per-account service quota
  const SERVICE_QUOTA = parseInt(process.env['MAX_SERVICES_PER_ACCOUNT'] ?? '50', 10);
  const existingCount = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
    columns: { id: true },
  });
  if (existingCount.length >= SERVICE_QUOTA) {
    return c.json({ error: `Service limit reached (${SERVICE_QUOTA}). Please delete unused services or contact support.` }, 429);
  }

  // Check for port collisions with other accounts' services
  if (data.ports.some((p) => p.published)) {
    const publishedPorts = data.ports.filter((p) => p.published).map((p) => p.published!);
    // Only fetch services from OTHER accounts (not the full table)
    const otherServices = await db.query.services.findMany({
      where: and(not(eq(services.accountId, accountId)), isNull(services.deletedAt)),
      columns: { id: true, ports: true },
    });
    for (const existing of otherServices) {
      const existingPorts = (existing.ports as any[])?.map((p: any) => p.published).filter(Boolean) ?? [];
      for (const port of publishedPorts) {
        if (existingPorts.includes(port)) {
          return c.json({ error: `Port ${port} is already in use by another service` }, 409);
        }
      }
    }
  }

  const traefikLabels = buildTraefikLabels(data.name, data.domain ?? null, data.sslEnabled);

  // Build constraints
  const constraints = [...data.placementConstraints];
  if (data.nodeConstraint) {
    constraints.push(`node.id == ${data.nodeConstraint}`);
  }

  // Insert into DB
  const [svc] = await insertReturning(services, {
    accountId,
    name: data.name,
    image: data.image,
    replicas: data.replicas,
    env: data.env,
    ports: data.ports,
    volumes: data.volumes,
    domain: data.domain ?? null,
    sslEnabled: data.sslEnabled,
    nodeConstraint: data.nodeConstraint ?? null,
    placementConstraints: data.placementConstraints,
    updateParallelism: data.updateParallelism,
    updateDelay: data.updateDelay,
    rollbackOnFailure: data.rollbackOnFailure,
    healthCheck: data.healthCheck ?? null,
    githubRepo: data.githubRepo ?? null,
    githubBranch: data.githubBranch ?? null,
    autoDeploy: data.autoDeploy,
    sourceType: data.sourceType ?? (data.githubRepo ? 'github' : 'docker'),
    sourcePath: data.sourcePath ?? null,
    status: 'deploying',
  });

  if (!svc) {
    return c.json({ error: 'Failed to create service record' }, 500);
  }

  // Register GitHub webhook if autoDeploy is enabled
  let webhookWarning: string | undefined;
  if (data.autoDeploy && data.githubRepo) {
    try {
      const webhookId = await manageWebhook({
        userId: user.userId,
        githubRepo: data.githubRepo,
        enable: true,
        existingWebhookId: null,
      });
      if (webhookId) {
        await db.update(services).set({ githubWebhookId: webhookId }).where(eq(services.id, svc.id));
        svc.githubWebhookId = webhookId;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to register GitHub webhook during service creation — auto-deploy may not work');
      // Disable autoDeploy since webhook registration failed
      await db.update(services).set({ autoDeploy: false }).where(eq(services.id, svc.id));
      svc.autoDeploy = false;
      webhookWarning = 'GitHub webhook registration failed — auto-deploy has been disabled. Re-enable it in service settings after connecting your GitHub account.';
    }
  }

  // Try to deploy to Docker Swarm (non-fatal — service record is always kept)
  try {
    const networkName = `fleet-account-${accountId}`;
    const networkId = await dockerService.ensureNetwork(networkName);

    const swarmServiceName = `fleet-${accountId.slice(0, 8)}-${data.name}`;

    const result = await dockerService.createService({
      name: swarmServiceName,
      image: data.image,
      replicas: data.replicas,
      env: data.env,
      ports: data.ports.map((p) => ({
        target: p.target,
        published: p.published ?? 0,
        protocol: p.protocol,
      })),
      volumes: data.volumes.map((v) => ({
        source: v.source,
        target: v.target,
        readonly: v.readonly,
      })),
      labels: {
        ...traefikLabels,
        'fleet.account-id': accountId,
        'fleet.service-id': svc.id,
      },
      constraints,
      healthCheck: data.healthCheck ?? undefined,
      updateParallelism: data.updateParallelism,
      updateDelay: data.updateDelay,
      rollbackOnFailure: data.rollbackOnFailure,
      networkId,
    });

    await db
      .update(services)
      .set({
        dockerServiceId: result.id,
        status: 'running',
        updatedAt: new Date(),
      })
      .where(eq(services.id, svc.id));

    const response: Record<string, unknown> = { ...svc, dockerServiceId: result.id, status: 'running' };
    if (webhookWarning) response.warning = webhookWarning;
    return c.json(response, 201);
  } catch (err) {
    logger.warn({ err }, 'Docker not available — service created but not started');
    await db
      .update(services)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(eq(services.id, svc.id));

    // Return 201 with stopped status so the client knows Docker deployment failed
    return c.json({ ...svc, status: 'stopped', warning: 'Docker deployment failed — service saved but not running' }, 201);
  }
});

// GET /:id — service details
serviceRoutes.get('/:id', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
    with: { deployments: { orderBy: (d, { desc }) => desc(d.createdAt), limit: 10 } },
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Optionally fetch live Docker status
  let dockerStatus = null;
  if (svc.dockerServiceId) {
    try {
      const info = await dockerService.inspectService(svc.dockerServiceId);
      const tasks = await dockerService.getServiceTasks(svc.dockerServiceId);
      dockerStatus = {
        createdAt: info.CreatedAt,
        updatedAt: info.UpdatedAt,
        runningTasks: tasks.filter((t) => t.status === 'running').length,
        desiredTasks: svc.replicas ?? 1,
        tasks,
      };
    } catch {
      // Docker service may not exist anymore
    }
  }

  return c.json({ ...svc, dockerStatus });
});

// PATCH /:id — update service
const updateServiceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  image: z.string().min(1).optional(),
  replicas: z.number().int().min(1).max(100).optional(),
  env: z.record(z.string()).optional(),
  ports: z.array(z.object({
    target: z.number().int().min(1).max(65535),
    published: z.number().int().min(1).max(65535).optional(),
    protocol: z.enum(['tcp', 'udp']).default('tcp'),
  })).optional(),
  domain: z.string().regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/).nullable().optional(),
  sslEnabled: z.boolean().optional(),
  placementConstraints: z.array(z.string()).optional(),
  nodeConstraint: z.string().nullable().optional(),
  updateParallelism: z.number().int().min(1).optional(),
  updateDelay: z.string().max(20).regex(/^\d+(\.\d+)?(ns|us|ms|s|m|h)$/, 'Invalid duration format').optional(),
  rollbackOnFailure: z.boolean().optional(),
  healthCheck: z.object({
    cmd: z.string().max(1000),
    interval: z.number().int().min(1),
    timeout: z.number().int().min(1),
    retries: z.number().int().min(1).max(20),
  }).nullable().optional(),
  autoDeploy: z.boolean().optional(),
  githubBranch: z.string().min(1).max(255).regex(/^[a-zA-Z0-9][a-zA-Z0-9._\-\/]*$/, 'Invalid branch name').optional(),
});

/**
 * Helper: register or remove GitHub webhook when autoDeploy changes.
 * Returns the webhook ID on registration, null on removal.
 */
async function manageWebhook(opts: {
  userId: string;
  githubRepo: string;
  enable: boolean;
  existingWebhookId: number | null;
}): Promise<number | null> {
  const oauth = await db.query.oauthProviders.findFirst({
    where: and(
      eq(oauthProviders.userId, opts.userId),
      eq(oauthProviders.provider, 'github'),
    ),
  });

  if (!oauth?.accessToken) {
    throw new Error('GitHub account not connected');
  }

  const token = decrypt(oauth.accessToken);
  const parts = opts.githubRepo.split('/');
  const owner = parts[0]!;
  const repo = parts[1]!;

  if (opts.enable) {
    // Build webhook URL from platform domain
    const platformDomain = process.env['PLATFORM_DOMAIN'] || process.env['CORS_ORIGIN']?.replace(/^https?:\/\//, '');
    const apiBase = platformDomain
      ? `https://${platformDomain}/api/v1`
      : `http://localhost:${process.env['PORT'] ?? '3000'}/api/v1`;
    const webhookUrl = `${apiBase}/deployments/github/webhook`;
    const webhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];

    if (!webhookSecret) {
      throw new Error('GITHUB_WEBHOOK_SECRET not configured');
    }

    const webhook = await githubService.createWebhook(token, owner, repo, webhookUrl, webhookSecret);
    return webhook.id;
  } else {
    // Remove existing webhook
    if (opts.existingWebhookId) {
      await githubService.deleteWebhook(token, owner, repo, opts.existingWebhookId).catch((err) => {
        logger.warn({ err, hookId: opts.existingWebhookId }, 'Failed to delete GitHub webhook (may already be removed)');
      });
    }
    return null;
  }
}

serviceRoutes.patch('/:id', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = updateServiceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const data = parsed.data;

  // Handle auto-deploy webhook management
  const autoDeployChanged = data.autoDeploy !== undefined && data.autoDeploy !== (svc.autoDeploy ?? false);
  let githubWebhookId = svc.githubWebhookId ?? null;

  if (autoDeployChanged && svc.githubRepo) {
    try {
      githubWebhookId = await manageWebhook({
        userId: user.userId,
        githubRepo: svc.githubRepo,
        enable: data.autoDeploy!,
        existingWebhookId: githubWebhookId,
      });
    } catch (err) {
      logger.error({ err }, 'GitHub webhook management failed');
      return c.json({ error: `Failed to ${data.autoDeploy ? 'register' : 'remove'} GitHub webhook: ${(err as Error).message}` }, 400);
    }
  }

  // Build DB update payload (exclude autoDeploy/githubBranch from Docker update)
  const { autoDeploy: _ad, githubBranch: _gb, ...dockerFields } = data;

  // If Docker update is needed, try Docker FIRST to ensure atomicity
  if (svc.dockerServiceId && Object.keys(dockerFields).length > 0) {
    try {
      const traefikLabels = buildTraefikLabels(
        dockerFields.name ?? svc.name,
        dockerFields.domain !== undefined ? dockerFields.domain : (svc.domain ?? null),
        dockerFields.sslEnabled ?? svc.sslEnabled ?? true,
      );

      await dockerService.updateService(svc.dockerServiceId, {
        image: dockerFields.image,
        replicas: dockerFields.replicas,
        env: dockerFields.env,
        labels: {
          ...traefikLabels,
          'fleet.account-id': accountId,
          'fleet.service-id': serviceId,
        },
        constraints: dockerFields.placementConstraints ?? (svc.placementConstraints as string[]) ?? [],
        ports: dockerFields.ports?.map((p) => ({
          target: p.target,
          published: p.published ?? 0,
          protocol: p.protocol,
        })),
        healthCheck: dockerFields.healthCheck ?? undefined,
        updateParallelism: dockerFields.updateParallelism,
        updateDelay: dockerFields.updateDelay,
        rollbackOnFailure: dockerFields.rollbackOnFailure,
      });
    } catch (err) {
      logger.error({ err }, 'Docker service update failed — DB not updated');
      return c.json({ error: 'Docker Swarm update failed — no changes applied' }, 500);
    }
  }

  // Docker succeeded (or not needed) — now persist to DB
  const [updated] = await updateReturning(services, {
    ...data,
    githubWebhookId,
    updatedAt: new Date(),
  }, eq(services.id, serviceId));

  await invalidateCache(`GET:/services:${accountId}`);

  return c.json(updated);
});

// DELETE /:id — destroy service
serviceRoutes.delete('/:id', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Remove from Docker Swarm
  if (svc.dockerServiceId) {
    try {
      await dockerService.removeService(svc.dockerServiceId);
    } catch (err) {
      logger.error({ err }, 'Docker service removal failed');
    }
  }

  // Clean up GitHub webhook
  if (svc.githubRepo && svc.githubWebhookId) {
    try {
      await manageWebhook({
        userId: user.userId,
        githubRepo: svc.githubRepo,
        enable: false,
        existingWebhookId: svc.githubWebhookId,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to clean up GitHub webhook on service delete');
    }
  }

  // Clean up uploaded source files
  if (svc.sourceType === 'upload' && svc.sourcePath) {
    try {
      const { uploadService } = await import('../services/upload.service.js');
      await uploadService.deleteServiceFiles(accountId, serviceId);
    } catch (err) {
      logger.error({ err }, 'Failed to clean up upload source files');
    }
  }

  // Soft-delete the service (keep deployment history)
  await db.update(services).set({ deletedAt: new Date(), status: 'deleted' }).where(eq(services.id, serviceId));

  await invalidateCache(`GET:/services:${accountId}`);

  return c.json({ message: 'Service destroyed' });
});

// POST /:id/restart — restart service (force update)
serviceRoutes.post('/:id/restart', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (!svc.dockerServiceId) {
    return c.json({ error: 'Service has no Docker deployment' }, 400);
  }

  try {
    // Force update triggers a rolling restart
    await dockerService.updateService(svc.dockerServiceId, {
      image: svc.image,
    });

    return c.json({ message: 'Service restart initiated' });
  } catch (err) {
    logger.error({ err }, 'Service restart failed');
    return c.json({ error: 'Failed to restart service' }, 500);
  }
});

// POST /:id/redeploy — rebuild and redeploy
serviceRoutes.post('/:id/redeploy', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Prevent duplicate deployments — reject if already deploying
  if (svc.status === 'deploying') {
    return c.json({ error: 'Service is already deploying. Wait for the current deployment to finish.' }, 409);
  }

  // Create deployment record
  const [deployment] = await insertReturning(deployments, {
    serviceId,
    status: 'deploying',
    imageTag: svc.image,
  });

  // Update service status
  await db
    .update(services)
    .set({ status: 'deploying', updatedAt: new Date() })
    .where(eq(services.id, serviceId));

  // If it has a Docker service, force re-pull the image
  if (svc.dockerServiceId) {
    try {
      await dockerService.updateService(svc.dockerServiceId, {
        image: svc.image,
      });

      await db
        .update(deployments)
        .set({ status: 'succeeded' })
        .where(eq(deployments.id, deployment!.id));

      await db
        .update(services)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(services.id, serviceId));
    } catch (err) {
      logger.error({ err }, 'Redeployment failed');

      await db
        .update(deployments)
        .set({ status: 'failed', log: String(err) })
        .where(eq(deployments.id, deployment!.id));

      await db
        .update(services)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(services.id, serviceId));
    }
  }

  return c.json({ message: 'Redeployment initiated', deploymentId: deployment?.id });
});

// POST /:id/stop — stop a running service (scale to 0)
serviceRoutes.post('/:id/stop', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (svc.status === 'deploying') {
    return c.json({ error: 'Cannot stop a service that is currently deploying' }, 409);
  }

  if (svc.status === 'stopped') {
    return c.json({ error: 'Service is already stopped' }, 400);
  }

  if (svc.dockerServiceId) {
    try {
      await dockerService.scaleService(svc.dockerServiceId, 0);
    } catch (err) {
      logger.error({ err }, 'Docker scale-to-zero failed');
      return c.json({ error: 'Failed to stop service in Docker' }, 500);
    }
  }

  await db
    .update(services)
    .set({ status: 'stopped', stoppedAt: new Date(), updatedAt: new Date() })
    .where(eq(services.id, serviceId));

  await invalidateCache(`GET:/services:${accountId}`);

  return c.json({ message: 'Service stopped' });
});

// POST /:id/start — start a stopped service (restore replicas)
serviceRoutes.post('/:id/start', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (svc.status !== 'stopped') {
    return c.json({ error: 'Service is not stopped' }, 400);
  }

  if (svc.dockerServiceId) {
    try {
      await dockerService.scaleService(svc.dockerServiceId, svc.replicas ?? 1);
    } catch (err) {
      logger.error({ err }, 'Docker scale-up failed');
      return c.json({ error: 'Failed to start service in Docker' }, 500);
    }
  }

  await db
    .update(services)
    .set({ status: 'running', stoppedAt: null, updatedAt: new Date() })
    .where(eq(services.id, serviceId));

  await invalidateCache(`GET:/services:${accountId}`);

  return c.json({ message: 'Service started' });
});

// GET /:id/logs — stream service logs
serviceRoutes.get('/:id/logs', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc || !svc.dockerServiceId) {
    return c.json({ error: 'Service not found or has no Docker deployment' }, 404);
  }

  const tail = Math.min(parseInt(c.req.query('tail') ?? '100', 10), 5000);

  try {
    const logStream = await dockerService.getServiceLogs(svc.dockerServiceId, {
      tail,
      follow: false,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of logStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }

    const logs = Buffer.concat(chunks).toString('utf-8');
    return c.json({ logs });
  } catch (err) {
    logger.error({ err }, 'Log fetch failed');
    return c.json({ error: 'Failed to fetch logs' }, 500);
  }
});

// GET /:id/deployments — deployment history
serviceRoutes.get('/:id/deployments', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const deploys = await db.query.deployments.findMany({
    where: eq(deployments.serviceId, serviceId),
    orderBy: (d, { desc }) => desc(d.createdAt),
    limit: 100,
  });

  return c.json(deploys);
});

export default serviceRoutes;
