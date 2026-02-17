import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { nfsService } from '../services/nfs.service.js';
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

// GET /volumes — list NFS volumes for the current account
storage.get('/volumes', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  try {
    const allVolumes = await nfsService.listVolumes();

    // Filter volumes belonging to this account by naming convention (prefix)
    const accountPrefix = `vol-${accountId.slice(0, 8)}-`;
    const volumes = allVolumes.filter((v) => v.name.startsWith(accountPrefix));

    return c.json(volumes);
  } catch (err) {
    logger.error({ err }, 'Failed to list volumes');
    return c.json({ error: 'Failed to list volumes' }, 500);
  }
});

// POST /volumes — create a new NFS volume
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
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { name, sizeGb, nodeId } = parsed.data;

  // Prefix volume name with account ID fragment for isolation
  const volumeName = `vol-${accountId.slice(0, 8)}-${name}`;

  try {
    const volume = await nfsService.createVolume(volumeName, sizeGb, nodeId);
    return c.json(volume, 201);
  } catch (err) {
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

  // The :id here is the user-provided name; reconstruct the full NFS volume name
  const volumeName = `vol-${accountId.slice(0, 8)}-${volumeId}`;

  try {
    const volume = await nfsService.getVolumeInfo(volumeName);
    return c.json(volume);
  } catch (err) {
    logger.error({ err }, 'Failed to get volume info');
    return c.json({ error: 'Volume not found' }, 404);
  }
});

// DELETE /volumes/:id — delete a volume
storage.delete('/volumes/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const volumeId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const volumeName = `vol-${accountId.slice(0, 8)}-${volumeId}`;

  try {
    // Verify volume exists before deleting
    await nfsService.getVolumeInfo(volumeName);
  } catch {
    return c.json({ error: 'Volume not found' }, 404);
  }

  try {
    await nfsService.deleteVolume(volumeName);
    return c.json({ message: 'Volume deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete volume');
    return c.json({ error: 'Failed to delete volume' }, 500);
  }
});

export default storage;
