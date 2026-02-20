import { Hono } from 'hono';
import { z } from 'zod';
import {
  db,
  storageClusters,
  storageNodes,
  storageVolumes,
  storageMigrations,
  eq,
  isNull,
  insertReturning,
} from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { storageManager } from '../services/storage/storage-manager.js';
import { migrationService } from '../services/storage/migration.service.js';
import { getMaintenanceQueue, isQueueAvailable } from '../services/queue.service.js';
import { logger } from '../services/logger.js';

// UUID param validation helper
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storageAdmin = new Hono<{
  Variables: { user: AuthUser };
}>();

storageAdmin.use('*', authMiddleware);

// Super user guard
storageAdmin.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }
  await next();
});

// ── Cluster ─────────────────────────────────────────────────────────────

// GET /cluster — Get current storage cluster config and health
storageAdmin.get('/cluster', async (c) => {
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
});

// POST /cluster — Initialize or update cluster config
const clusterSchema = z.object({
  provider: z.enum(['local', 'glusterfs', 'ceph']),
  objectProvider: z.enum(['local', 'minio', 's3', 'gcs']),
  replicationFactor: z.number().int().min(1).max(5).default(3),
  config: z.record(z.any()).default({}),
  objectConfig: z.record(z.any()).default({}),
});

storageAdmin.post('/cluster', async (c) => {
  const body = await c.req.json();
  const parsed = clusterSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;
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

    logger.error({ err }, 'Failed to initialize storage cluster');
    return c.json({ error: 'Failed to initialize storage cluster', status: 'error' }, 500);
  }
});

// POST /cluster/test — Test connectivity to storage nodes
storageAdmin.post('/cluster/test', async (c) => {
  const health = await storageManager.getHealth();
  return c.json(health);
});

// ── Nodes ───────────────────────────────────────────────────────────────

// GET /nodes — List storage nodes
storageAdmin.get('/nodes', async (c) => {
  const nodes = await db.query.storageNodes.findMany({
    with: { node: true },
  });
  return c.json(nodes);
});

// POST /nodes — Add a storage node
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

storageAdmin.post('/nodes', async (c) => {
  const body = await c.req.json();
  const parsed = addNodeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const cluster = await db.query.storageClusters.findFirst();

  const [node] = await insertReturning(storageNodes, {
    clusterId: cluster?.id ?? null,
    nodeId: parsed.data.nodeId ?? null,
    hostname: parsed.data.hostname,
    ipAddress: parsed.data.ipAddress,
    role: parsed.data.role,
    storagePathRoot: parsed.data.storagePathRoot,
    capacityGb: parsed.data.capacityGb ?? null,
    status: 'pending',
  });

  return c.json(node, 201);
});

// DELETE /nodes/:id — Remove a storage node
storageAdmin.delete('/nodes/:id', async (c) => {
  const nodeId = c.req.param('id');
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

  return c.json({ message: 'Storage node removed' });
});

// ── Volumes (admin view) ────────────────────────────────────────────────

// GET /volumes — List all volumes across all accounts
storageAdmin.get('/volumes', async (c) => {
  const volumes = await db.query.storageVolumes.findMany({
    where: isNull(storageVolumes.deletedAt),
    with: { account: true },
  });
  return c.json(volumes);
});

// ── Health ──────────────────────────────────────────────────────────────

// GET /health — Detailed storage health
storageAdmin.get('/health', async (c) => {
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
});

// ── Migrations ──────────────────────────────────────────────────────────

// POST /migrate — Start a data migration
const migrateSchema = z.object({
  toProvider: z.enum(['local', 'glusterfs', 'ceph']),
  toObjectProvider: z.enum(['local', 'minio', 's3', 'gcs']).optional(),
});

storageAdmin.post('/migrate', async (c) => {
  const body = await c.req.json();
  const parsed = migrateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const cluster = await db.query.storageClusters.findFirst();
  const fromProvider = cluster?.provider ?? 'local';

  if (parsed.data.toProvider === fromProvider) {
    return c.json({ error: 'Target provider is the same as current provider' }, 400);
  }

  const [migration] = await insertReturning(storageMigrations, {
    fromProvider,
    toProvider: parsed.data.toProvider,
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
});

// GET /migrate/:id — Get migration progress
storageAdmin.get('/migrate/:id', async (c) => {
  const id = c.req.param('id');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid migration ID' }, 400);

  const progress = await migrationService.getProgress(id);

  if (!progress) {
    return c.json({ error: 'Migration not found' }, 404);
  }

  return c.json(progress);
});

// POST /migrate/:id/pause — Pause a running migration
storageAdmin.post('/migrate/:id/pause', async (c) => {
  const id = c.req.param('id');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid migration ID' }, 400);

  try {
    await migrationService.pauseMigration(id);
    return c.json({ message: 'Migration paused' });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to pause migration' }, 400);
  }
});

// POST /migrate/:id/resume — Resume a paused migration
storageAdmin.post('/migrate/:id/resume', async (c) => {
  const id = c.req.param('id');
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
});

// POST /migrate/:id/rollback — Rollback a completed/failed migration
storageAdmin.post('/migrate/:id/rollback', async (c) => {
  const id = c.req.param('id');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid migration ID' }, 400);

  try {
    await migrationService.rollbackMigration(id);
    return c.json({ message: 'Migration rolled back' });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to rollback migration' }, 400);
  }
});

// GET /migrate — List all migrations
storageAdmin.get('/migrate', async (c) => {
  const migrations = await db.query.storageMigrations.findMany();
  return c.json(migrations);
});

export default storageAdmin;
