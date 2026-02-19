import { Hono } from 'hono';
import { z } from 'zod';
import { db, storageVolumes, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { storageManager } from '../services/storage/storage-manager.js';
import { requireMember } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';

const storage = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

storage.use('*', authMiddleware);
storage.use('*', tenantMiddleware);

// GET /volumes — list volumes for the current account
storage.get('/volumes', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  try {
    const volumes = await storageManager.listAccountVolumes(accountId);
    return c.json(volumes);
  } catch (err) {
    logger.error({ err }, 'Failed to list volumes');
    return c.json({ error: 'Failed to list volumes' }, 500);
  }
});

// GET /volumes/quota — get storage quota and usage for the current account
storage.get('/volumes/quota', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  try {
    const [usage, limit] = await Promise.all([
      storageManager.getAccountStorageUsage(accountId),
      storageManager.getAccountStorageLimit(accountId),
    ]);
    return c.json({ usedGb: usage, limitGb: limit, provider: storageManager.config?.provider ?? 'local' });
  } catch (err) {
    logger.error({ err }, 'Failed to get storage quota');
    return c.json({ error: 'Failed to get storage quota' }, 500);
  }
});

// POST /volumes — create a new volume
const createVolumeSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      'Name must be lowercase alphanumeric with hyphens, not starting or ending with a hyphen',
    ),
  sizeGb: z.number().int().min(1).max(1000),
  nodeId: z.string().uuid().optional(),
});

storage.post('/volumes', requireMember, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = createVolumeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { name, sizeGb, nodeId } = parsed.data;

  // Use full accountId in volume name for collision-free isolation
  const volumeName = `vol-${accountId}-${name}`;

  try {
    const volume = await storageManager.createVolume(accountId, volumeName, name, sizeGb, nodeId);
    return c.json(volume, 201);
  } catch (err: any) {
    if (err?.message?.includes('quota exceeded')) {
      return c.json({ error: err.message }, 403);
    }
    logger.error({ err }, 'Failed to create volume');
    return c.json({ error: 'Failed to create volume' }, 500);
  }
});

// GET /volumes/:id — get volume details
storage.get('/volumes/:id', async (c) => {
  const accountId = c.get('accountId');
  const volumeId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Look up volume in DB by displayName + accountId (authoritative ownership check)
  const dbVolume = await db.query.storageVolumes.findFirst({
    where: and(
      eq(storageVolumes.displayName, volumeId),
      eq(storageVolumes.accountId, accountId),
      isNull(storageVolumes.deletedAt),
    ),
  });

  if (!dbVolume) {
    return c.json({ error: 'Volume not found' }, 404);
  }

  try {
    const volume = await storageManager.volumes.getVolumeInfo(dbVolume.name);
    return c.json(volume);
  } catch (err) {
    logger.error({ err }, 'Failed to get volume info');
    // Return DB data as fallback if provider query fails
    return c.json({
      name: dbVolume.name,
      path: dbVolume.mountPath ?? '',
      sizeGb: dbVolume.sizeGb,
      usedGb: dbVolume.usedGb ?? 0,
      availableGb: dbVolume.sizeGb - (dbVolume.usedGb ?? 0),
      replicaCount: dbVolume.replicaCount ?? 1,
      status: dbVolume.status,
    });
  }
});

// DELETE /volumes/:id — delete a volume
storage.delete('/volumes/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const volumeId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Look up volume in DB by displayName + accountId (authoritative ownership check)
  const dbVolume = await db.query.storageVolumes.findFirst({
    where: and(
      eq(storageVolumes.displayName, volumeId),
      eq(storageVolumes.accountId, accountId),
      isNull(storageVolumes.deletedAt),
    ),
  });

  if (!dbVolume) {
    return c.json({ error: 'Volume not found' }, 404);
  }

  try {
    await storageManager.deleteVolume(accountId, dbVolume.name);
    return c.json({ message: 'Volume deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete volume');
    return c.json({ error: 'Failed to delete volume' }, 500);
  }
});

export default storage;
