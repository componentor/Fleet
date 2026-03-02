import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, storageVolumes, eq, and, isNull } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { dockerService } from '../services/docker.service.js';
import { orchestrator } from '../services/orchestrator.js';
import { VolumeFileService } from '../services/volume-file.service.js';
import { logger } from '../services/logger.js';
import { jsonBody, jsonContent, errorResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

// Block uploads of server-side executable files
const BLOCKED_EXTENSIONS = new Set([
  '.php', '.php3', '.php4', '.php5', '.phtml',
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif',
  '.jsp', '.jspx', '.asp', '.aspx', '.ashx',
  '.cgi', '.pl', '.py', '.rb', '.sh', '.bash',
  '.htaccess', '.htpasswd',
]);

function hasBlockedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return BLOCKED_EXTENSIONS.has(lower) || [...BLOCKED_EXTENSIONS].some(ext => lower.endsWith(ext));
}

let _volumeFileService: VolumeFileService | null = null;
function getVolumeFileService(): VolumeFileService {
  if (!_volumeFileService) {
    _volumeFileService = new VolumeFileService(dockerService.getDockerClient());
  }
  return _volumeFileService;
}

const volumeFileRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

volumeFileRoutes.use('*', authMiddleware);
volumeFileRoutes.use('*', tenantMiddleware);

/**
 * Verify the volume belongs to the requesting account.
 */
async function getOwnedVolume(accountId: string, volumeName: string) {
  const vol = await db.query.storageVolumes.findFirst({
    where: and(
      eq(storageVolumes.name, volumeName),
      eq(storageVolumes.accountId, accountId),
      isNull(storageVolumes.deletedAt),
    ),
  });

  if (!vol) return { error: 'Volume not found', status: 404 as const, vol: null };
  return { error: null, status: null, vol };
}

// GET /:volumeName/list — list directory
const listRoute = createRoute({
  method: 'get',
  path: '/{volumeName}/list',
  tags: ['Volume Files'],
  summary: 'List directory contents in a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    query: z.object({ path: z.string().optional() }),
  },
  responses: {
    200: jsonContent(z.object({ entries: z.any(), currentPath: z.string() }), 'Directory listing'),
    ...standardErrors,
  },
});

volumeFileRoutes.openapi(listRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { volumeName } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, vol } = await getOwnedVolume(accountId, volumeName);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('query');
  const dirPath = path || '/';

  try {
    const svc = getVolumeFileService();
    const entries = await svc.listDirectory(volumeName, dirPath);
    return c.json({ entries, currentPath: dirPath });
  } catch (err) {
    logger.error({ err, volumeName }, 'Failed to list volume directory');
    return c.json({ error: 'Failed to list directory' }, 500);
  }
}) as any);

// GET /:volumeName/read — read file content
const readRoute = createRoute({
  method: 'get',
  path: '/{volumeName}/read',
  tags: ['Volume Files'],
  summary: 'Read file content from a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    query: z.object({ path: z.string().optional() }),
  },
  responses: {
    200: jsonContent(z.any(), 'File content'),
    ...standardErrors,
    413: jsonContent(errorResponseSchema, 'File too large'),
  },
});

volumeFileRoutes.openapi(readRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { volumeName } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status } = await getOwnedVolume(accountId, volumeName);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('query');
  if (!path) return c.json({ error: 'Path parameter is required' }, 400);

  try {
    const svc = getVolumeFileService();
    const result = await svc.readFile(volumeName, path);
    return c.json({ ...result, path });
  } catch (err: any) {
    if (err.message?.includes('too large')) return c.json({ error: 'File too large' }, 413);
    if (err.message?.includes('traversal')) return c.json({ error: 'Invalid path' }, 400);
    if (err.message?.includes('directory')) return c.json({ error: 'Cannot read a directory' }, 400);
    return c.json({ error: 'Failed to read file' }, 500);
  }
}) as any);

// PUT /:volumeName/write — write file content
const writeRoute = createRoute({
  method: 'put',
  path: '/{volumeName}/write',
  tags: ['Volume Files'],
  summary: 'Write file content to a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    body: jsonBody(z.object({ path: z.string(), content: z.string() })),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string(), path: z.string() }), 'File saved'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

volumeFileRoutes.openapi(writeRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { volumeName } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status } = await getOwnedVolume(accountId, volumeName);
  if (error) return c.json({ error }, status!);

  const { path, content } = c.req.valid('json');
  if (!path || content === undefined) return c.json({ error: 'Path and content are required' }, 400);

  try {
    const svc = getVolumeFileService();
    await svc.writeFile(volumeName, path, content);
    return c.json({ message: 'File saved', path });
  } catch (err: any) {
    if (err.message?.includes('traversal')) return c.json({ error: 'Invalid path' }, 400);
    return c.json({ error: 'Failed to write file' }, 500);
  }
}) as any);

// POST /:volumeName/mkdir — create directory
const mkdirRoute = createRoute({
  method: 'post',
  path: '/{volumeName}/mkdir',
  tags: ['Volume Files'],
  summary: 'Create a directory in a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    body: jsonBody(z.object({ path: z.string() })),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string(), path: z.string() }), 'Directory created'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

volumeFileRoutes.openapi(mkdirRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { volumeName } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status } = await getOwnedVolume(accountId, volumeName);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('json');
  if (!path) return c.json({ error: 'Path is required' }, 400);

  try {
    const svc = getVolumeFileService();
    await svc.createDirectory(volumeName, path);
    return c.json({ message: 'Directory created', path });
  } catch (err: any) {
    if (err.message?.includes('traversal')) return c.json({ error: 'Invalid path' }, 400);
    return c.json({ error: 'Failed to create directory' }, 500);
  }
}) as any);

// DELETE /:volumeName/delete — delete file or directory
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{volumeName}/delete',
  tags: ['Volume Files'],
  summary: 'Delete a file or directory from a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    body: jsonBody(z.object({ path: z.string() })),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string(), path: z.string() }), 'Entry deleted'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

volumeFileRoutes.openapi(deleteRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { volumeName } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status } = await getOwnedVolume(accountId, volumeName);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('json');
  if (!path) return c.json({ error: 'Path is required' }, 400);

  try {
    const svc = getVolumeFileService();
    await svc.deleteEntry(volumeName, path);
    return c.json({ message: 'Deleted', path });
  } catch (err: any) {
    if (err.message?.includes('traversal') || err.message?.includes('root directory')) {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to delete' }, 500);
  }
}) as any);

// GET /:volumeName/download — download a single file
const downloadRoute = createRoute({
  method: 'get',
  path: '/{volumeName}/download',
  tags: ['Volume Files'],
  summary: 'Download a single file from a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    query: z.object({ path: z.string().optional() }),
  },
  responses: {
    200: { description: 'File download stream', content: { 'application/octet-stream': { schema: z.any() } } },
    ...standardErrors,
  },
});

volumeFileRoutes.openapi(downloadRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { volumeName } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status } = await getOwnedVolume(accountId, volumeName);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('query');
  if (!path) return c.json({ error: 'Path parameter is required' }, 400);

  try {
    const svc = getVolumeFileService();
    const { stream, filename } = await svc.downloadFile(volumeName, path);
    const safeFilename = filename.replace(/["\r\n\\]/g, '_');
    c.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
    c.header('Content-Type', 'application/octet-stream');
    return c.body(stream as any);
  } catch (err: any) {
    if (err.message?.includes('traversal')) return c.json({ error: 'Invalid path' }, 400);
    return c.json({ error: 'Failed to download file' }, 500);
  }
}) as any);

// GET /:volumeName/download-archive — download volume as archive
const downloadArchiveRoute = createRoute({
  method: 'get',
  path: '/{volumeName}/download-archive',
  tags: ['Volume Files'],
  summary: 'Download entire volume as an archive',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    query: z.object({ format: z.enum(['zip', 'tar']).optional() }),
  },
  responses: {
    200: { description: 'Archive download stream', content: { 'application/octet-stream': { schema: z.any() } } },
    ...standardErrors,
  },
});

volumeFileRoutes.openapi(downloadArchiveRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { volumeName } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, vol } = await getOwnedVolume(accountId, volumeName);
  if (error) return c.json({ error }, status!);

  const { format: queryFormat } = c.req.valid('query');
  const format = (queryFormat || 'tar') as 'zip' | 'tar';

  try {
    const svc = getVolumeFileService();
    const { stream } = await svc.downloadArchive(volumeName, format);
    const ext = format === 'zip' ? 'zip' : 'tar.gz';
    const safeName = (vol!.displayName ?? volumeName).replace(/["\r\n\\]/g, '_');
    c.header('Content-Disposition', `attachment; filename="${safeName}.${ext}"`);
    c.header('Content-Type', format === 'zip' ? 'application/zip' : 'application/gzip');
    return c.body(stream as any);
  } catch (err) {
    logger.error({ err, volumeName }, 'Failed to create volume archive');
    return c.json({ error: 'Failed to create archive' }, 500);
  }
}) as any);

// POST /:volumeName/upload — upload a file
const uploadFileRoute = createRoute({
  method: 'post',
  path: '/{volumeName}/upload',
  tags: ['Volume Files'],
  summary: 'Upload a file to a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({ type: 'string', format: 'binary' }),
            path: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonContent(z.object({ message: z.string(), path: z.string() }), 'File uploaded'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

volumeFileRoutes.openapi(uploadFileRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { volumeName } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status } = await getOwnedVolume(accountId, volumeName);
  if (error) return c.json({ error }, status!);

  const body = await c.req.parseBody({ all: true });
  const file = body['file'] as File | undefined;
  const targetPath = (body['path'] as string) || '/';

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'File is required' }, 400);
  }

  if (hasBlockedExtension(file.name)) {
    return c.json({ error: 'File type not allowed for security reasons' }, 400);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = targetPath === '/' ? file.name : `${targetPath}/${file.name}`;
    const svc = getVolumeFileService();
    await svc.writeFileRaw(volumeName, filePath, buffer);
    return c.json({ message: 'File uploaded', path: filePath });
  } catch (err: any) {
    if (err.message?.includes('traversal')) return c.json({ error: 'Invalid path' }, 400);
    return c.json({ error: 'Failed to upload file' }, 500);
  }
}) as any);

export default volumeFileRoutes;
