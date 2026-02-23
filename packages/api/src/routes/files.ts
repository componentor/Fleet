import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { createReadStream } from 'node:fs';
import { db, services, eq, and, isNull } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { uploadService } from '../services/upload.service.js';
import { logger } from '../services/logger.js';
import { rm } from 'node:fs/promises';
import { jsonBody, jsonContent, errorResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

// Block uploads of server-side executable files that could be exploited if served directly
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

const fileRoutes = new OpenAPIHono<{
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
const listRoute = createRoute({
  method: 'get',
  path: '/{serviceId}/list',
  tags: ['Files'],
  summary: 'List directory contents for a service',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
    query: z.object({
      path: z.string().optional(),
    }),
  },
  responses: {
    200: jsonContent(z.object({
      entries: z.any(),
      currentPath: z.string(),
    }), 'Directory listing'),
    ...standardErrors,
  },
});

fileRoutes.openapi(listRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('query');
  const dirPath = path || '/';

  try {
    const entries = await uploadService.listDirectory(svc!.sourcePath!, dirPath);
    return c.json({ entries, currentPath: dirPath });
  } catch (err) {
    logger.error({ err }, 'Failed to list directory');
    return c.json({ error: 'Failed to list directory' }, 500);
  }
}) as any);

// GET /:serviceId/read — read file content
const readRoute = createRoute({
  method: 'get',
  path: '/{serviceId}/read',
  tags: ['Files'],
  summary: 'Read file content from a service',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
    query: z.object({
      path: z.string().optional(),
    }),
  },
  responses: {
    200: jsonContent(z.any(), 'File content'),
    ...standardErrors,
    413: jsonContent(errorResponseSchema, 'File too large'),
  },
});

fileRoutes.openapi(readRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('query');
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
}) as any);

// PUT /:serviceId/write — write file content
const writeFileBodySchema = z.object({
  path: z.string(),
  content: z.string(),
});

const writeRoute = createRoute({
  method: 'put',
  path: '/{serviceId}/write',
  tags: ['Files'],
  summary: 'Write file content to a service',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
    body: jsonBody(writeFileBodySchema),
  },
  responses: {
    200: jsonContent(z.object({
      message: z.string(),
      path: z.string(),
    }), 'File saved'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

fileRoutes.openapi(writeRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const { path, content } = c.req.valid('json');

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
}) as any);

// POST /:serviceId/mkdir — create directory
const mkdirBodySchema = z.object({
  path: z.string(),
});

const mkdirRoute = createRoute({
  method: 'post',
  path: '/{serviceId}/mkdir',
  tags: ['Files'],
  summary: 'Create a directory in a service',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
    body: jsonBody(mkdirBodySchema),
  },
  responses: {
    200: jsonContent(z.object({
      message: z.string(),
      path: z.string(),
    }), 'Directory created'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

fileRoutes.openapi(mkdirRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('json');

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
}) as any);

// DELETE /:serviceId/delete — delete file or directory
const deleteBodySchema = z.object({
  path: z.string(),
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{serviceId}/delete',
  tags: ['Files'],
  summary: 'Delete a file or directory from a service',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
    body: jsonBody(deleteBodySchema),
  },
  responses: {
    200: jsonContent(z.object({
      message: z.string(),
      path: z.string(),
    }), 'Entry deleted'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

fileRoutes.openapi(deleteRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('json');

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
}) as any);

// GET /:serviceId/download — download a single file
const downloadRoute = createRoute({
  method: 'get',
  path: '/{serviceId}/download',
  tags: ['Files'],
  summary: 'Download a single file from a service',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
    query: z.object({
      path: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'File download stream',
      content: { 'application/octet-stream': { schema: z.any() } },
    },
    ...standardErrors,
  },
});

fileRoutes.openapi(downloadRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const { path } = c.req.valid('query');
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
}) as any);

// GET /:serviceId/download-archive — download entire project as archive
const downloadArchiveRoute = createRoute({
  method: 'get',
  path: '/{serviceId}/download-archive',
  tags: ['Files'],
  summary: 'Download entire project as an archive',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
    query: z.object({
      format: z.enum(['zip', 'tar']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Archive download stream',
      content: { 'application/octet-stream': { schema: z.any() } },
    },
    ...standardErrors,
  },
});

fileRoutes.openapi(downloadArchiveRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
  if (error) return c.json({ error }, status!);

  const { format: queryFormat } = c.req.valid('query');
  const format = (queryFormat || 'zip') as 'zip' | 'tar';
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
}) as any);

// POST /:serviceId/upload — upload files to a specific path
const uploadFileRoute = createRoute({
  method: 'post',
  path: '/{serviceId}/upload',
  tags: ['Files'],
  summary: 'Upload a file to a specific path in a service',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
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
    200: jsonContent(z.object({
      message: z.string(),
      path: z.string(),
    }), 'File uploaded'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

fileRoutes.openapi(uploadFileRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { error, status, svc } = await getUploadService(accountId, serviceId);
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
    await uploadService.writeFileRaw(svc!.sourcePath!, filePath, buffer);
    return c.json({ message: 'File uploaded', path: filePath });
  } catch (err: any) {
    if (err.message?.includes('traversal')) {
      return c.json({ error: 'Invalid path' }, 400);
    }
    return c.json({ error: 'Failed to upload file' }, 500);
  }
}) as any);

export default fileRoutes;
