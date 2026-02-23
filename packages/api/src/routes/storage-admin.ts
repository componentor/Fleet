import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import {
  db,
  users,
  storageClusters,
  storageNodes,
  storageVolumes,
  storageMigrations,
  eq,
  and,
  or,
  isNull,
  insertReturning,
  updateReturning,
} from '@fleet/db';
import { verify } from 'argon2';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { storageManager } from '../services/storage/storage-manager.js';
import { migrationService } from '../services/storage/migration.service.js';
import { getMaintenanceQueue, isQueueAvailable } from '../services/queue.service.js';
import { logger } from '../services/logger.js';
import {
  jsonBody,
  jsonContent,
  errorResponseSchema,
  messageResponseSchema,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

// UUID param validation helper
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Env = {
  Variables: { user: AuthUser };
};

const storageAdmin = new OpenAPIHono<Env>();

storageAdmin.use('*', authMiddleware);

// Super user guard
storageAdmin.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }
  await next();
});

// ── Schemas ──

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Resource ID' }),
});

/** Reject private/loopback IPs to prevent SSRF via storage endpoints. */
function isPrivateOrLoopback(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  // RFC 1918 + link-local
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  if (/^fc00:|^fe80:/i.test(hostname)) return true;
  return false;
}

const objectConfigSchema = z.record(z.string(), z.any()).default({}).refine((config) => {
  if (config.endpoint) {
    try {
      const url = new URL(config.endpoint);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      if (isPrivateOrLoopback(url.hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}, 'objectConfig.endpoint must be a valid public URL (no private/loopback IPs)');

const clusterSchema = z.object({
  provider: z.enum(['local', 'glusterfs', 'ceph']),
  objectProvider: z.enum(['local', 'minio', 's3', 'gcs']),
  replicationFactor: z.number().int().min(1).max(5).default(3),
  config: z.record(z.string(), z.any()).default({}),
  objectConfig: objectConfigSchema,
});

const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
const hostnameRe = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,253}$/;
const safePathRe = /^\/[a-zA-Z0-9/_-]+$/;

const addNodeSchema = z.object({
  nodeId: z.string().uuid().optional(),
  hostname: z.string().min(1).max(253).regex(hostnameRe, 'Invalid hostname'),
  ipAddress: z.string().regex(ipv4Re, 'Invalid IPv4 address').refine((ip) => {
    return ip.split('.').every((p) => { const n = Number(p); return n >= 0 && n <= 255; });
  }, 'IP octets must be 0-255'),
  role: z.enum(['storage', 'storage+compute', 'arbiter']).default('storage'),
  storagePathRoot: z.string().default('/srv/fleet-storage').refine((p) => {
    return safePathRe.test(p) && !p.includes('..');
  }, 'Invalid storage path'),
  capacityGb: z.number().int().optional(),
});

const passwordConfirmSchema = z.object({
  password: z.string().min(1),
});

/** Verify the authenticated user's password. Returns error response or null if valid. */
async function verifyPassword(c: any): Promise<Response | null> {
  const { password } = c.req.valid('json');
  if (!password) return c.json({ error: 'Password confirmation required' }, 400);
  const user = c.get('user');
  const dbUser = await db.query.users.findFirst({
    where: and(eq(users.id, user.userId), isNull(users.deletedAt)),
  });
  if (!dbUser?.passwordHash) return c.json({ error: 'Cannot verify identity' }, 400);
  const valid = await verify(dbUser.passwordHash, password);
  if (!valid) return c.json({ error: 'Invalid password' }, 403);
  return null;
}

const migrateSchema = z.object({
  toProvider: z.enum(['local', 'glusterfs', 'ceph']),
  toObjectProvider: z.enum(['local', 'minio', 's3', 'gcs']).optional(),
});

// ── Cluster Routes ──

// GET /cluster — Get current storage cluster config and health
const getClusterRoute = createRoute({
  method: 'get',
  path: '/cluster',
  tags: ['Storage Admin'],
  summary: 'Get current storage cluster config and health',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Storage cluster configuration and health'),
    ...standardErrors,
  },
});

storageAdmin.openapi(getClusterRoute, (async (c: any) => {
  const cluster = await db.query.storageClusters.findFirst();
  const health = await storageManager.getHealth();
  const nodes = await db.query.storageNodes.findMany();

  return c.json({
    cluster: cluster ?? {
      provider: 'local',
      objectProvider: 'local',
      status: 'healthy',
      replicationFactor: 1,
    },
    health,
    nodes,
  });
}) as any);

// POST /cluster — Initialize or update cluster config
const postClusterRoute = createRoute({
  method: 'post',
  path: '/cluster',
  tags: ['Storage Admin'],
  summary: 'Initialize or update cluster configuration',
  security: bearerSecurity,
  request: {
    body: jsonBody(clusterSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Cluster configured successfully'),
  },
});

storageAdmin.openapi(postClusterRoute, (async (c: any) => {
  const data = c.req.valid('json');

  const existing = await db.query.storageClusters.findFirst();

  if (existing) {
    await db.update(storageClusters).set({
      provider: data.provider,
      objectProvider: data.objectProvider,
      replicationFactor: data.replicationFactor,
      config: data.config,
      objectConfig: data.objectConfig,
      status: 'initializing',
      updatedAt: new Date(),
    }).where(eq(storageClusters.id, existing.id));
  } else {
    await insertReturning(storageClusters, {
      provider: data.provider,
      objectProvider: data.objectProvider,
      replicationFactor: data.replicationFactor,
      config: data.config,
      objectConfig: data.objectConfig,
      status: 'initializing',
    });
  }

  // Reload storage manager with new config
  try {
    await storageManager.reload();

    // Mark as healthy if reload succeeds
    const cluster = await db.query.storageClusters.findFirst();
    if (cluster) {
      await db.update(storageClusters).set({
        status: 'healthy',
        updatedAt: new Date(),
      }).where(eq(storageClusters.id, cluster.id));
    }

    return c.json({ message: 'Storage cluster configured', status: 'healthy' });
  } catch (err) {
    // Mark as error
    const cluster = await db.query.storageClusters.findFirst();
    if (cluster) {
      await db.update(storageClusters).set({
        status: 'error',
        updatedAt: new Date(),
      }).where(eq(storageClusters.id, cluster.id));
    }

    const detail = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Failed to initialize storage cluster');
    return c.json({ error: `Failed to initialize storage cluster: ${detail}`, status: 'error' }, 500);
  }
}) as any);

// POST /cluster/test — Test connectivity to storage nodes
const testClusterRoute = createRoute({
  method: 'post',
  path: '/cluster/test',
  tags: ['Storage Admin'],
  summary: 'Test connectivity to storage nodes',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Storage health check results'),
    ...standardErrors,
  },
});

storageAdmin.openapi(testClusterRoute, (async (c: any) => {
  const health = await storageManager.getHealth();
  return c.json(health);
}) as any);

// ── Node Routes ──

// GET /nodes — List storage nodes
const listNodesRoute = createRoute({
  method: 'get',
  path: '/nodes',
  tags: ['Storage Admin'],
  summary: 'List storage nodes',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'List of storage nodes'),
    ...standardErrors,
  },
});

storageAdmin.openapi(listNodesRoute, (async (c: any) => {
  const nodes = await db.query.storageNodes.findMany({
    with: { node: true },
  });
  return c.json(nodes);
}) as any);

// POST /nodes — Add a storage node
const addNodeRoute = createRoute({
  method: 'post',
  path: '/nodes',
  tags: ['Storage Admin'],
  summary: 'Add a storage node',
  security: bearerSecurity,
  request: {
    body: jsonBody(addNodeSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Storage node created'),
  },
});

storageAdmin.openapi(addNodeRoute, (async (c: any) => {
  const data = c.req.valid('json');

  const cluster = await db.query.storageClusters.findFirst();

  // Check for existing node with same hostname + IP (exact match = wizard retry, allow upsert)
  const exactMatch = await db.query.storageNodes.findFirst({
    where: and(
      eq(storageNodes.hostname, data.hostname),
      eq(storageNodes.ipAddress, data.ipAddress),
    ),
  });

  if (exactMatch) {
    // Wizard retry — update existing node instead of creating a duplicate
    const [updated] = await updateReturning(
      storageNodes,
      {
        clusterId: cluster?.id ?? null,
        nodeId: data.nodeId ?? null,
        role: data.role,
        storagePathRoot: data.storagePathRoot,
        capacityGb: data.capacityGb ?? null,
        status: 'pending',
        updatedAt: new Date(),
      },
      eq(storageNodes.id, exactMatch.id),
    );
    return c.json(updated, 200);
  }

  // Check for partial match (hostname OR IP already in use by another node)
  const conflict = await db.query.storageNodes.findFirst({
    where: or(
      eq(storageNodes.hostname, data.hostname),
      eq(storageNodes.ipAddress, data.ipAddress),
    ),
  });

  if (conflict) {
    const reason = conflict.hostname === data.hostname
      ? `Hostname "${data.hostname}" is already attached (IP: ${conflict.ipAddress})`
      : `IP address ${data.ipAddress} is already attached (hostname: ${conflict.hostname})`;
    return c.json({ error: reason }, 409);
  }

  const [node] = await insertReturning(storageNodes, {
    clusterId: cluster?.id ?? null,
    nodeId: data.nodeId ?? null,
    hostname: data.hostname,
    ipAddress: data.ipAddress,
    role: data.role,
    storagePathRoot: data.storagePathRoot,
    capacityGb: data.capacityGb ?? null,
    status: 'pending',
  });

  return c.json(node, 201);
}) as any);

// DELETE /nodes — Remove all storage nodes (cleanup/reset)
const deleteAllNodesRoute = createRoute({
  method: 'delete',
  path: '/nodes',
  tags: ['Storage Admin'],
  summary: 'Remove all storage nodes (requires password confirmation)',
  security: bearerSecurity,
  request: {
    body: jsonBody(passwordConfirmSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'All storage nodes removed'),
  },
});

storageAdmin.openapi(deleteAllNodesRoute, (async (c: any) => {
  const denied = await verifyPassword(c);
  if (denied) return denied;

  const all = await db.query.storageNodes.findMany();
  if (all.length > 0) {
    for (const node of all) {
      await db.delete(storageNodes).where(eq(storageNodes.id, node.id));
    }
  }

  // Also reset the cluster config
  const cluster = await db.query.storageClusters.findFirst();
  if (cluster) {
    await db.delete(storageClusters).where(eq(storageClusters.id, cluster.id));
  }

  return c.json({ message: `Removed ${all.length} storage node(s) and reset cluster configuration` });
}) as any);

// DELETE /nodes/:id — Detach a storage node (requires password confirmation)
const deleteNodeRoute = createRoute({
  method: 'delete',
  path: '/nodes/{id}',
  tags: ['Storage Admin'],
  summary: 'Detach a storage node (requires password confirmation)',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonBody(passwordConfirmSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Storage node detached'),
  },
});

storageAdmin.openapi(deleteNodeRoute, (async (c: any) => {
  const denied = await verifyPassword(c);
  if (denied) return denied;

  const { id: nodeId } = c.req.valid('param');
  if (!uuidRe.test(nodeId)) return c.json({ error: 'Invalid node ID' }, 400);

  const node = await db.query.storageNodes.findFirst({
    where: eq(storageNodes.id, nodeId),
  });

  if (!node) {
    return c.json({ error: 'Storage node not found' }, 404);
  }

  // If GlusterFS, detach the peer first
  if (storageManager.config?.provider === 'glusterfs') {
    try {
      const { GlusterFSVolumeProvider } = await import('../services/storage/providers/glusterfs-volume.provider.js');
      const provider = storageManager.volumes as InstanceType<typeof GlusterFSVolumeProvider>;
      if (typeof provider.removePeer === 'function') {
        await provider.removePeer(node.ipAddress);
      }
    } catch (err) {
      logger.warn({ err, nodeId }, 'Failed to detach GlusterFS peer');
    }
  }

  await db.delete(storageNodes).where(eq(storageNodes.id, nodeId));

  return c.json({ message: `Storage node ${node.hostname} detached` });
}) as any);

// ── Volume Routes ──

// GET /volumes — List all volumes across all accounts
const listVolumesRoute = createRoute({
  method: 'get',
  path: '/volumes',
  tags: ['Storage Admin'],
  summary: 'List all volumes across all accounts',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'List of storage volumes'),
    ...standardErrors,
  },
});

storageAdmin.openapi(listVolumesRoute, (async (c: any) => {
  const volumes = await db.query.storageVolumes.findMany({
    where: isNull(storageVolumes.deletedAt),
    with: { account: true },
  });
  return c.json(volumes);
}) as any);

// ── Health Route ──

// GET /health — Detailed storage health
const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Storage Admin'],
  summary: 'Get detailed storage health',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Detailed storage health information'),
    ...standardErrors,
  },
});

storageAdmin.openapi(healthRoute, (async (c: any) => {
  const health = await storageManager.getHealth();
  const nodes = await db.query.storageNodes.findMany();
  const cluster = await db.query.storageClusters.findFirst();

  return c.json({
    cluster: {
      provider: cluster?.provider ?? 'local',
      objectProvider: cluster?.objectProvider ?? 'local',
      status: cluster?.status ?? 'healthy',
      replicationFactor: cluster?.replicationFactor ?? 1,
    },
    health,
    nodes: nodes.map((n) => ({
      ...n,
      healthy: n.status === 'active',
    })),
  });
}) as any);

// ── Migration Routes ──

// POST /migrate — Start a data migration
const startMigrateRoute = createRoute({
  method: 'post',
  path: '/migrate',
  tags: ['Storage Admin'],
  summary: 'Start a data migration',
  security: bearerSecurity,
  request: {
    body: jsonBody(migrateSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Migration created'),
  },
});

storageAdmin.openapi(startMigrateRoute, (async (c: any) => {
  const data = c.req.valid('json');

  const cluster = await db.query.storageClusters.findFirst();
  const fromProvider = cluster?.provider ?? 'local';

  if (data.toProvider === fromProvider) {
    return c.json({ error: 'Target provider is the same as current provider' }, 400);
  }

  const [migration] = await insertReturning(storageMigrations, {
    fromProvider,
    toProvider: data.toProvider,
    status: 'pending',
    progress: 0,
  });

  // Queue migration job via BullMQ
  if (migration && isQueueAvailable()) {
    await getMaintenanceQueue().add(
      'storage-migration',
      { type: 'storage-migration', migrationId: migration.id },
      { jobId: `migration:${migration.id}`, removeOnComplete: false, removeOnFail: false },
    );
  }

  return c.json(migration, 201);
}) as any);

// GET /migrate/:id — Get migration progress
const getMigrateRoute = createRoute({
  method: 'get',
  path: '/migrate/{id}',
  tags: ['Storage Admin'],
  summary: 'Get migration progress',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Migration progress'),
    ...standardErrors,
  },
});

storageAdmin.openapi(getMigrateRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid migration ID' }, 400);

  const progress = await migrationService.getProgress(id);

  if (!progress) {
    return c.json({ error: 'Migration not found' }, 404);
  }

  return c.json(progress);
}) as any);

// POST /migrate/:id/pause — Pause a running migration
const pauseMigrateRoute = createRoute({
  method: 'post',
  path: '/migrate/{id}/pause',
  tags: ['Storage Admin'],
  summary: 'Pause a running migration',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Migration paused'),
  },
});

storageAdmin.openapi(pauseMigrateRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid migration ID' }, 400);

  try {
    await migrationService.pauseMigration(id);
    return c.json({ message: 'Migration paused' });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to pause migration' }, 400);
  }
}) as any);

// POST /migrate/:id/resume — Resume a paused migration
const resumeMigrateRoute = createRoute({
  method: 'post',
  path: '/migrate/{id}/resume',
  tags: ['Storage Admin'],
  summary: 'Resume a paused migration',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Migration resumed'),
  },
});

storageAdmin.openapi(resumeMigrateRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid migration ID' }, 400);

  try {
    await migrationService.resumeMigration(id);

    // Re-queue the migration job
    if (isQueueAvailable()) {
      await getMaintenanceQueue().add(
        'storage-migration',
        { type: 'storage-migration', migrationId: id },
        { jobId: `migration-resume:${id}:${Date.now()}`, removeOnComplete: false, removeOnFail: false },
      );
    }

    return c.json({ message: 'Migration resumed' });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to resume migration' }, 400);
  }
}) as any);

// POST /migrate/:id/rollback — Rollback a completed/failed migration
const rollbackMigrateRoute = createRoute({
  method: 'post',
  path: '/migrate/{id}/rollback',
  tags: ['Storage Admin'],
  summary: 'Rollback a completed or failed migration',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Migration rolled back'),
  },
});

storageAdmin.openapi(rollbackMigrateRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid migration ID' }, 400);

  try {
    await migrationService.rollbackMigration(id);
    return c.json({ message: 'Migration rolled back' });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to rollback migration' }, 400);
  }
}) as any);

// GET /migrate — List all migrations
const listMigrationsRoute = createRoute({
  method: 'get',
  path: '/migrate',
  tags: ['Storage Admin'],
  summary: 'List all migrations',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'List of migrations'),
    ...standardErrors,
  },
});

storageAdmin.openapi(listMigrationsRoute, (async (c: any) => {
  const migrations = await db.query.storageMigrations.findMany();
  return c.json(migrations);
}) as any);

export default storageAdmin;
