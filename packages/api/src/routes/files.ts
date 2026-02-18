import { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { db, services, eq, and, isNull } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { uploadService } from '../services/upload.service.js';
import { logger } from '../services/logger.js';
import { writeFile as writeFileFs } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

const fileRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

fileRoutes.use('*', authMiddleware);
fileRoutes.use('*', tenantMiddleware);

/**
 * Helper: get a service and validate it's an upload-deployed service.
 */
async function getUploadService(accountId: string, serviceId: string) {
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) return { error: 'Service not found', status: 404 as const, svc: null };
  if (svc.sourceType !== 'upload' || !svc.sourcePath) {
    return { error: 'Service does not have uploaded source files', status: 400 as const, svc: null };
  }

  return { error: null, status: null, svc };
}

// GET /:serviceId/list — list directory
fileRoutes.get('/:serviceId/list', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const path = c.req.query('path') || '/';

  try {
    const entries = await uploadService.listDirectory(svc!.sourcePath!, path);
    return c.json({ entries, currentPath: path });
  } catch (err) {
    logger.error({ err }, 'Failed to list directory');
    return c.json({ error: 'Failed to list directory' }, 500);
  }
});

// GET /:serviceId/read — read file content
fileRoutes.get('/:serviceId/read', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const path = c.req.query('path');
  if (!path) return c.json({ error: 'Path parameter is required' }, 400);

  try {
    const result = await uploadService.readFile(svc!.sourcePath!, path);
    return c.json({ ...result, path });
  } catch (err: any) {
    if (err.message?.includes('too large')) {
      return c.json({ error: 'File too large' }, 413);
    }
    if (err.message?.includes('traversal')) {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to read file' }, 500);
  }
});

// PUT /:serviceId/write — write file content
fileRoutes.put('/:serviceId/write', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const body = await c.req.json();
  const { path, content } = body as { path?: string; content?: string };

  if (!path || content === undefined) {
    return c.json({ error: 'Path and content are required' }, 400);
  }

  try {
    await uploadService.writeFile(svc!.sourcePath!, path, content);
    return c.json({ message: 'File saved', path });
  } catch (err: any) {
    if (err.message?.includes('traversal')) {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to write file' }, 500);
  }
});

// POST /:serviceId/mkdir — create directory
fileRoutes.post('/:serviceId/mkdir', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const body = await c.req.json();
  const { path } = body as { path?: string };

  if (!path) return c.json({ error: 'Path is required' }, 400);

  try {
    await uploadService.createDirectory(svc!.sourcePath!, path);
    return c.json({ message: 'Directory created', path });
  } catch (err: any) {
    if (err.message?.includes('traversal')) {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to create directory' }, 500);
  }
});

// DELETE /:serviceId/delete — delete file or directory
fileRoutes.delete('/:serviceId/delete', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const body = await c.req.json();
  const { path } = body as { path?: string };

  if (!path) return c.json({ error: 'Path is required' }, 400);

  try {
    await uploadService.deleteEntry(svc!.sourcePath!, path);
    return c.json({ message: 'Deleted', path });
  } catch (err: any) {
    if (err.message?.includes('traversal') || err.message?.includes('root directory')) {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to delete' }, 500);
  }
});

// GET /:serviceId/download — download a single file
fileRoutes.get('/:serviceId/download', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const path = c.req.query('path');
  if (!path) return c.json({ error: 'Path parameter is required' }, 400);

  try {
    const { stream, filename } = uploadService.downloadFile(svc!.sourcePath!, path);
    // Sanitize filename to prevent header injection
    const safeFilename = filename.replace(/["\r\n\\]/g, '_');
    c.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
    c.header('Content-Type', 'application/octet-stream');
    return c.body(stream as any);
  } catch (err: any) {
    if (err.message?.includes('traversal')) {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to download file' }, 500);
  }
});

// GET /:serviceId/download-archive — download entire project as archive
fileRoutes.get('/:serviceId/download-archive', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const format = (c.req.query('format') || 'zip') as 'zip' | 'tar';
  if (format !== 'zip' && format !== 'tar') {
    return c.json({ error: 'Format must be zip or tar' }, 400);
  }

  try {
    const archive = await uploadService.createArchive(svc!.sourcePath!, format);
    const ext = format === 'zip' ? 'zip' : 'tar.gz';
    const safeName = svc!.name.replace(/["\r\n\\]/g, '_');
    c.header('Content-Disposition', `attachment; filename="${safeName}-source.${ext}"`);
    c.header('Content-Type', format === 'zip' ? 'application/zip' : 'application/gzip');

    const stream = createReadStream(archive.path);
    // Clean up temp file after streaming
    stream.on('end', () => {
      rm(archive.path, { force: true }).catch(() => {});
    });
    stream.on('error', () => {
      rm(archive.path, { force: true }).catch(() => {});
    });

    return c.body(stream as any);
  } catch (err) {
    logger.error({ err }, 'Failed to create archive');
    return c.json({ error: 'Failed to create archive' }, 500);
  }
});

// POST /:serviceId/upload — upload files to a specific path
fileRoutes.post('/:serviceId/upload', requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const body = await c.req.parseBody({ all: true });
  const file = body['file'] as File | undefined;
  const targetPath = (body['path'] as string) || '/';

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'File is required' }, 400);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = targetPath === '/' ? file.name : `${targetPath}/${file.name}`;
    await uploadService.writeFile(svc!.sourcePath!, filePath, buffer.toString('utf-8'));
    return c.json({ message: 'File uploaded', path: filePath });
  } catch (err: any) {
    if (err.message?.includes('traversal')) {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to upload file' }, 500);
  }
});

export default fileRoutes;
