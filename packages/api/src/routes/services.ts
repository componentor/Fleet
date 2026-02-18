import { Hono } from 'hono';
import { z } from 'zod';
import { db, services, deployments, insertReturning, updateReturning, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { dockerService } from '../services/docker.service.js';
import { requireMember } from '../middleware/rbac.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { logger } from '../services/logger.js';

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
    where: eq(services.accountId, accountId),
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
    target: z.number().int(),
    published: z.number().int().optional(),
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
  updateDelay: z.string().default('10s'),
  rollbackOnFailure: z.boolean().default(true),
  healthCheck: z.object({
    cmd: z.string(),
    interval: z.number().int(),
    timeout: z.number().int(),
    retries: z.number().int(),
  }).nullable().optional(),
  githubRepo: z.string().nullable().optional(),
  githubBranch: z.string().nullable().optional(),
  autoDeploy: z.boolean().default(false),
});

serviceRoutes.post('/', requireMember, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = createServiceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;
  const traefikLabels = buildTraefikLabels(data.name, data.domain ?? null, data.sslEnabled);

  // Build constraints
  const constraints = [...data.placementConstraints];
  if (data.nodeConstraint) {
    constraints.push(`node.id == ${data.nodeConstraint}`);
  }

  // Insert into DB first
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
    status: 'deploying',
  });

  if (!svc) {
    return c.json({ error: 'Failed to create service record' }, 500);
  }

  // Deploy to Docker Swarm
  try {
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
    });

    // Update DB with Docker service ID
    await db
      .update(services)
      .set({
        dockerServiceId: result.id,
        status: 'running',
        updatedAt: new Date(),
      })
      .where(eq(services.id, svc.id));

    return c.json({ ...svc, dockerServiceId: result.id, status: 'running' }, 201);
  } catch (err) {
    // Mark as failed if Docker deployment fails
    await db
      .update(services)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(services.id, svc.id));

    logger.error({ err }, 'Docker service creation failed');
    return c.json({
      error: 'Failed to deploy service to Docker Swarm',
      serviceId: svc.id,
    }, 500);
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
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
    target: z.number().int(),
    published: z.number().int().optional(),
    protocol: z.enum(['tcp', 'udp']).default('tcp'),
  })).optional(),
  domain: z.string().regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/).nullable().optional(),
  sslEnabled: z.boolean().optional(),
  placementConstraints: z.array(z.string()).optional(),
  nodeConstraint: z.string().nullable().optional(),
  updateParallelism: z.number().int().min(1).optional(),
  updateDelay: z.string().optional(),
  rollbackOnFailure: z.boolean().optional(),
  healthCheck: z.object({
    cmd: z.string(),
    interval: z.number().int(),
    timeout: z.number().int(),
    retries: z.number().int(),
  }).nullable().optional(),
});

serviceRoutes.patch('/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = updateServiceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const data = parsed.data;

  // Update DB
  const [updated] = await updateReturning(services, {
    ...data,
    updatedAt: new Date(),
  }, eq(services.id, serviceId));

  // Update Docker Swarm service if it exists
  if (svc.dockerServiceId) {
    try {
      const traefikLabels = buildTraefikLabels(
        data.name ?? svc.name,
        data.domain !== undefined ? data.domain : (svc.domain ?? null),
        data.sslEnabled ?? svc.sslEnabled ?? true,
      );

      await dockerService.updateService(svc.dockerServiceId, {
        image: data.image,
        replicas: data.replicas,
        env: data.env,
        labels: {
          ...traefikLabels,
          'fleet.account-id': accountId,
          'fleet.service-id': serviceId,
        },
        constraints: data.placementConstraints ?? (svc.placementConstraints as string[]) ?? [],
        ports: data.ports?.map((p) => ({
          target: p.target,
          published: p.published ?? 0,
          protocol: p.protocol,
        })),
        healthCheck: data.healthCheck ?? undefined,
        updateParallelism: data.updateParallelism,
        updateDelay: data.updateDelay,
        rollbackOnFailure: data.rollbackOnFailure,
      });
    } catch (err) {
      logger.error({ err }, 'Docker service update failed');
      // Don't fail the DB update, but inform the client
      return c.json({
        ...updated,
        warning: 'DB updated but Docker Swarm update failed',
      });
    }
  }

  await invalidateCache(`GET:/services:${accountId}`);

  return c.json(updated);
});

// DELETE /:id — destroy service
serviceRoutes.delete('/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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

  // Delete deployments first, then service
  await db.delete(deployments).where(eq(deployments.serviceId, serviceId));
  await db.delete(services).where(eq(services.id, serviceId));

  await invalidateCache(`GET:/services:${accountId}`);

  return c.json({ message: 'Service destroyed' });
});

// POST /:id/restart — restart service (force update)
serviceRoutes.post('/:id/restart', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
serviceRoutes.post('/:id/redeploy', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
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
serviceRoutes.post('/:id/stop', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
serviceRoutes.post('/:id/start', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
