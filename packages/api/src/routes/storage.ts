import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, storageVolumes, services, eq, and, or, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { storageManager } from '../services/storage/storage-manager.js';
import { requireMember } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const [volumes, accountServices] = await Promise.all([
      storageManager.listAccountVolumes(accountId),
      db.select({ volumes: services.volumes })
        .from(services)
        .where(and(eq(services.accountId, accountId), isNull(services.deletedAt))),
    ]);

    // Count how many services reference each volume by name
    const volumeServiceCount = new Map<string, number>();
    for (const svc of accountServices) {
      const vols = svc.volumes as Array<{ source: string }> | null;
      if (!Array.isArray(vols)) continue;
      const seen = new Set<string>();
      for (const v of vols) {
        if (v.source && !seen.has(v.source)) {
          seen.add(v.source);
          volumeServiceCount.set(v.source, (volumeServiceCount.get(v.source) ?? 0) + 1);
        }
      }
    }

    return c.json(volumes.map((v) => ({
      ...v,
      serviceCount: volumeServiceCount.get(v.name) ?? 0,
    })));
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
  region: z.string().max(50).nullable().optional(),
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

  const { name, sizeGb, nodeId, region } = c.req.valid('json');

  // Use full accountId in volume name for collision-free isolation
  const volumeName = `vol-${accountId}-${name}`;

  try {
    const volume = await storageManager.createVolume(accountId, volumeName, name, sizeGb, nodeId, region ?? null);
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

  // Look up volume in DB by id, name, or displayName (dashboard may pass any of these)
  const nameMatch = or(eq(storageVolumes.name, volumeId), eq(storageVolumes.displayName, volumeId));
  const idMatch = UUID_RE.test(volumeId) ? or(eq(storageVolumes.id, volumeId), nameMatch) : nameMatch;
  const dbVolume = await db.query.storageVolumes.findFirst({
    where: and(
      idMatch,
      eq(storageVolumes.accountId, accountId),
      isNull(storageVolumes.deletedAt),
    ),
  });

  if (!dbVolume) {
    return c.json({ error: 'Volume not found' }, 404);
  }

  try {
    const cluster = dbVolume.clusterId ? storageManager.getCluster(dbVolume.clusterId) : undefined;
    const provider = cluster?.volumeProvider ?? storageManager.volumes;
    const live = await provider.getVolumeInfo(dbVolume.name);
    // Use DB-tracked sizeGb when available (provider reports entire NFS filesystem size)
    const allocatedGb = (dbVolume.sizeGb != null && dbVolume.sizeGb > 0) ? dbVolume.sizeGb : live.sizeGb;
    return c.json({
      ...live,
      sizeGb: allocatedGb,
      availableGb: allocatedGb - live.usedGb,
      displayName: dbVolume.displayName ?? dbVolume.name,
    });
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

  // Look up volume in DB by id, name, or displayName (dashboard may pass any of these)
  const delNameMatch = or(eq(storageVolumes.name, volumeId), eq(storageVolumes.displayName, volumeId));
  const delIdMatch = UUID_RE.test(volumeId) ? or(eq(storageVolumes.id, volumeId), delNameMatch) : delNameMatch;
  const dbVolume = await db.query.storageVolumes.findFirst({
    where: and(
      delIdMatch,
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
