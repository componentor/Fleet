import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, storageVolumes, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { storageManager } from '../services/storage/storage-manager.js';
import { requireMember } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const storage = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

storage.use('*', authMiddleware);
storage.use('*', tenantMiddleware);

// GET /volumes — list volumes for the current account
const listVolumesRoute = createRoute({
  method: 'get',
  path: '/volumes',
  tags: ['Storage'],
  summary: 'List volumes for the current account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'List of volumes'),
    ...standardErrors,
  },
});

storage.openapi(listVolumesRoute, (async (c: any) => {
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
}) as any);

// GET /volumes/quota — get storage quota and usage for the current account
const getVolumeQuotaRoute = createRoute({
  method: 'get',
  path: '/volumes/quota',
  tags: ['Storage'],
  summary: 'Get storage quota and usage',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      usedGb: z.number(),
      limitGb: z.number(),
      provider: z.string(),
    }), 'Storage quota info'),
    ...standardErrors,
  },
});

storage.openapi(getVolumeQuotaRoute, (async (c: any) => {
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
}) as any);

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

const createVolumeRoute = createRoute({
  method: 'post',
  path: '/volumes',
  tags: ['Storage'],
  summary: 'Create a new volume',
  security: bearerSecurity,
  request: {
    body: jsonBody(createVolumeSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Volume created'),
    ...standardErrors,
  },
  middleware: [requireMember],
});

storage.openapi(createVolumeRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { name, sizeGb, nodeId } = c.req.valid('json');

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
}) as any);

// GET /volumes/:id — get volume details
const getVolumeRoute = createRoute({
  method: 'get',
  path: '/volumes/{id}',
  tags: ['Storage'],
  summary: 'Get volume details',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Volume details'),
    ...standardErrors,
  },
});

storage.openapi(getVolumeRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: volumeId } = c.req.valid('param');

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
}) as any);

// DELETE /volumes/:id — delete a volume
const deleteVolumeRoute = createRoute({
  method: 'delete',
  path: '/volumes/{id}',
  tags: ['Storage'],
  summary: 'Delete a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Volume deleted'),
    ...standardErrors,
  },
  middleware: [requireMember],
});

storage.openapi(deleteVolumeRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: volumeId } = c.req.valid('param');

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
}) as any);

export default storage;
