import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { templateService } from '../services/template.service.js';
import { requireMember, requireAdmin } from '../middleware/rbac.js';
import { cache } from '../middleware/cache.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import {
  jsonBody,
  jsonContent,
  errorResponseSchema,
  messageResponseSchema,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

const deployRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'marketplace-deploy' });
const imageTagsRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: 'image-tags' });

const marketplace = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

marketplace.use('*', authMiddleware);
marketplace.use('*', tenantMiddleware);

// ── Schemas ──

const templateSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  iconUrl: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  isBuiltin: z.boolean().nullable(),
}).openapi('TemplateSummary');

const templateDetailSchema = templateSummarySchema.extend({
  composeTemplate: z.string(),
  serviceDefinitions: z.any().optional(),
  volumes: z.any().optional(),
}).openapi('TemplateDetail');

const imageTagsResponseSchema = z.object({
  tags: z.array(z.string()),
  defaultTag: z.string(),
}).openapi('ImageTagsResponse');

const deploySchema = z.object({
  slug: z.string().min(1),
  config: z.record(z.string(), z.string()).default({}),
  composeOverride: z.string().optional(),
  imageOverrides: z.record(z.string(), z.string().min(1)).optional(),
  domainOverrides: z.record(z.string(), z.string().min(1)).optional(),
  resourceOverrides: z.record(z.string(), z.object({
    replicas: z.number().int().min(0).max(100).optional(),
    cpuLimit: z.number().int().min(0).optional(),
    memoryLimit: z.number().int().min(0).optional(),
  })).optional(),
  volumeOverrides: z.record(z.string(), z.object({
    mode: z.enum(['create', 'existing']),
    sizeGb: z.number().int().min(1).max(1000).optional(),
    existingVolumeName: z.string().min(1).optional(),
  })).optional(),
  volumeGroups: z.array(z.object({
    name: z.string().min(1),
    volumes: z.array(z.string().min(1)),
    mode: z.enum(['create', 'existing']),
    sizeGb: z.number().int().min(1).max(1000).optional(),
    existingVolumeName: z.string().min(1).optional(),
  })).optional(),
  planId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
}).openapi('MarketplaceDeploy');

const createTemplateSchema = z.object({
  slug: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  iconUrl: z.string().url().optional(),
  category: z.string().optional(),
  composeTemplate: z.string().min(1),
  isBuiltin: z.boolean().optional(),
}).openapi('CreateTemplate');

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  iconUrl: z.string().url().optional(),
  category: z.string().optional(),
  composeTemplate: z.string().min(1).optional(),
}).openapi('UpdateTemplate');

const slugParamSchema = z.object({
  slug: z.string().openapi({ description: 'Template slug' }),
});

const imageQuerySchema = z.object({
  image: z.string().min(1).openapi({ description: 'Docker image name' }),
});

const categoryQuerySchema = z.object({
  category: z.string().optional().openapi({ description: 'Filter by category' }),
});

// ── Routes ──

// GET /templates — list all available templates
const listTemplatesRoute = createRoute({
  method: 'get',
  path: '/templates',
  tags: ['Marketplace'],
  summary: 'List all available templates',
  security: bearerSecurity,
  middleware: [cache(600)] as const,
  request: {
    query: categoryQuerySchema,
  },
  responses: {
    200: jsonContent(z.array(templateSummarySchema), 'List of templates'),
    ...standardErrors,
  },
});

marketplace.openapi(listTemplatesRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { category } = c.req.valid('query');

  const templates = await templateService.listTemplates({
    category: category ?? undefined,
    accountId: accountId ?? undefined,
  });

  return c.json(templates, 200);
}) as any);

// GET /templates/categories — list template categories
const listCategoriesRoute = createRoute({
  method: 'get',
  path: '/templates/categories',
  tags: ['Marketplace'],
  summary: 'List template categories',
  security: bearerSecurity,
  middleware: [],
  responses: {
    200: jsonContent(z.array(z.string()), 'List of categories'),
    ...standardErrors,
  },
});

marketplace.openapi(listCategoriesRoute, (async (c: any) => {
  const categories = await templateService.getCategories();
  return c.json(categories, 200);
}) as any);

// GET /templates/:slug — get template details with variable schema
const getTemplateRoute = createRoute({
  method: 'get',
  path: '/templates/{slug}',
  tags: ['Marketplace'],
  summary: 'Get template details',
  security: bearerSecurity,
  middleware: [],
  request: {
    params: slugParamSchema,
  },
  responses: {
    200: jsonContent(templateDetailSchema, 'Template details'),
    ...standardErrors,
  },
});

marketplace.openapi(getTemplateRoute, (async (c: any) => {
  const { slug } = c.req.valid('param');

  const template = await templateService.getTemplate(slug);

  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }

  // Parse the compose template to get full service definitions for the response
  const parsed = templateService.parseTemplate(template.composeTemplate);

  return c.json({
    ...template,
    serviceDefinitions: parsed.services,
    volumes: parsed.volumes,
  }, 200);
}) as any);

// GET /image-tags — fetch available Docker Hub tags for an image
const imageTagsRoute = createRoute({
  method: 'get',
  path: '/image-tags',
  tags: ['Marketplace'],
  summary: 'Fetch available Docker Hub tags for an image',
  security: bearerSecurity,
  middleware: [imageTagsRateLimit, cache(600)] as const,
  request: {
    query: imageQuerySchema,
  },
  responses: {
    200: jsonContent(imageTagsResponseSchema, 'Image tags'),
    ...standardErrors,
  },
});

marketplace.openapi(imageTagsRoute, (async (c: any) => {
  const { image } = c.req.valid('query');

  // Parse image into namespace/repo (official images use "library" namespace)
  const parts = image.split(':')[0]!.split('/');
  let namespace: string;
  let repo: string;
  if (parts.length === 1) {
    namespace = 'library';
    repo = parts[0]!;
  } else {
    namespace = parts[0]!;
    repo = parts.slice(1).join('/');
  }

  // Extract the default tag from the full image string
  const defaultTag = image.includes(':') ? image.split(':')[1]! : 'latest';

  try {
    const res = await fetch(
      `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags?page_size=50&ordering=last_updated`,
      { signal: AbortSignal.timeout(5000) },
    );

    if (!res.ok) {
      return c.json({ tags: [defaultTag], defaultTag }, 200);
    }

    const data = (await res.json()) as { results?: Array<{ name: string }> };
    const rawTags = (data.results ?? []).map((t: any) => t.name);

    // Filter out SHA digests and overly long tags, keep meaningful versions
    const filtered = rawTags.filter((tag: string) => {
      if (tag.length > 40) return false;
      if (/^sha-/.test(tag)) return false;
      if (/^[0-9a-f]{7,}$/.test(tag)) return false;
      return true;
    });

    // Ensure the default tag is included at the top
    const tags = filtered.includes(defaultTag)
      ? [defaultTag, ...filtered.filter((t: string) => t !== defaultTag)]
      : [defaultTag, ...filtered];

    return c.json({ tags, defaultTag }, 200);
  } catch (err) {
    logger.error({ err, image }, 'Failed to fetch Docker Hub tags');
    logToErrorTable({ level: 'warn', message: `Docker Hub tag fetch failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'marketplace', operation: 'docker-hub-tags' } });
    return c.json({ tags: [defaultTag], defaultTag }, 200);
  }
}) as any);

// POST /deploy — deploy a template
const deployRoute = createRoute({
  method: 'post',
  path: '/deploy',
  tags: ['Marketplace'],
  summary: 'Deploy a template',
  security: bearerSecurity,
  middleware: [deployRateLimit, requireMember] as const,
  request: {
    body: jsonBody(deploySchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Deployment result'),
    ...standardErrors,
  },
});

marketplace.openapi(deployRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { slug, config, composeOverride, imageOverrides, domainOverrides, resourceOverrides, volumeOverrides, volumeGroups, planId } = c.req.valid('json');

  try {
    const result = await templateService.deployTemplate(slug, accountId, config, {
      composeOverride,
      imageOverrides,
      domainOverrides,
      resourceOverrides,
      volumeOverrides,
      volumeGroups,
      planId,
    });
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';

    if (message.includes('not found')) {
      return c.json({ error: 'Template not found' }, 404);
    }
    if (message.includes('Missing required variable')) {
      return c.json({ error: 'Missing required template variables' }, 400);
    }
    if (message.includes('quota exceeded')) {
      return c.json({ error: message }, 403);
    }

    logger.error({ err }, 'Template deployment failed');
    logToErrorTable({ level: 'error', message: `Template deployment failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'marketplace', operation: 'deploy-template' } });
    return c.json({ error: 'Failed to deploy template' }, 500);
  }
}) as any);

// POST /templates — create a custom template (admin or account-scoped)
const createTemplateRoute = createRoute({
  method: 'post',
  path: '/templates',
  tags: ['Marketplace'],
  summary: 'Create a custom template',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  request: {
    body: jsonBody(createTemplateSchema),
  },
  responses: {
    201: jsonContent(templateDetailSchema, 'Created template'),
    ...standardErrors,
  },
});

marketplace.openapi(createTemplateRoute, (async (c: any) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  const data = c.req.valid('json');

  if (data.isBuiltin && !user.isSuper) {
    return c.json({ error: 'Only super users can create builtin templates' }, 403);
  }

  try {
    const template = await templateService.createTemplate({
      ...data,
      accountId: data.isBuiltin ? undefined : (accountId ?? undefined),
    });

    return c.json(template, 201);
  } catch (err) {
    logger.error({ err }, 'Template creation failed');
    logToErrorTable({ level: 'error', message: `Template creation failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'marketplace', operation: 'create-template' } });
    return c.json({ error: 'Failed to create template' }, 500);
  }
}) as any);

// PATCH /templates/:slug — update a template
const updateTemplateRoute = createRoute({
  method: 'patch',
  path: '/templates/{slug}',
  tags: ['Marketplace'],
  summary: 'Update a template',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  request: {
    params: slugParamSchema,
    body: jsonBody(updateTemplateSchema),
  },
  responses: {
    200: jsonContent(templateDetailSchema, 'Updated template'),
    ...standardErrors,
  },
});

marketplace.openapi(updateTemplateRoute, (async (c: any) => {
  const user = c.get('user');
  const { slug } = c.req.valid('param');

  const template = await templateService.getTemplate(slug);

  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }

  // Only super users can update builtin templates
  if (template.isBuiltin && !user.isSuper) {
    return c.json({ error: 'Only super users can update builtin templates' }, 403);
  }

  const data = c.req.valid('json');

  try {
    const updated = await templateService.updateTemplate(template.id, data);
    return c.json(updated, 200);
  } catch (err) {
    logger.error({ err }, 'Template update failed');
    logToErrorTable({ level: 'error', message: `Template update failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'marketplace', operation: 'update-template' } });
    return c.json({ error: 'Failed to update template' }, 500);
  }
}) as any);

// DELETE /templates/:slug — delete a template
const deleteTemplateRoute = createRoute({
  method: 'delete',
  path: '/templates/{slug}',
  tags: ['Marketplace'],
  summary: 'Delete a template',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  request: {
    params: slugParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Template deleted'),
    ...standardErrors,
  },
});

marketplace.openapi(deleteTemplateRoute, (async (c: any) => {
  const user = c.get('user');
  const { slug } = c.req.valid('param');

  const template = await templateService.getTemplate(slug);

  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }

  if (template.isBuiltin && !user.isSuper) {
    return c.json({ error: 'Only super users can delete builtin templates' }, 403);
  }

  const deleted = await templateService.deleteTemplate(template.id);

  if (!deleted) {
    return c.json({ error: 'Failed to delete template' }, 500);
  }

  return c.json({ message: 'Template deleted' }, 200);
}) as any);

// POST /sync — sync builtin templates from disk (admin only)
const syncRoute = createRoute({
  method: 'post',
  path: '/sync',
  tags: ['Marketplace'],
  summary: 'Sync builtin templates from disk',
  security: bearerSecurity,
  middleware: [],
  responses: {
    200: jsonContent(messageResponseSchema, 'Sync result'),
    ...standardErrors,
  },
});

marketplace.openapi(syncRoute, (async (c: any) => {
  const user = c.get('user');

  if (!user.isSuper) {
    return c.json({ error: 'Only super users can sync templates' }, 403);
  }

  try {
    await templateService.syncBuiltinTemplates();
    return c.json({ message: 'Templates synced successfully' }, 200);
  } catch (err) {
    logger.error({ err }, 'Template sync failed');
    logToErrorTable({ level: 'error', message: `Template sync failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'marketplace', operation: 'sync-templates' } });
    return c.json({ error: 'Failed to sync templates' }, 500);
  }
}) as any);

export default marketplace;
