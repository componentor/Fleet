import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { templateService } from '../services/template.service.js';
import { requireMember } from '../middleware/rbac.js';
import { cache } from '../middleware/cache.js';
import { logger } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';

const deployRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'marketplace-deploy' });

const marketplace = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

marketplace.use('*', authMiddleware);
marketplace.use('*', tenantMiddleware);

// GET /templates — list all available templates
marketplace.get('/templates', cache(600), async (c) => {
  const accountId = c.get('accountId');
  const category = c.req.query('category');

  const templates = await templateService.listTemplates({
    category: category ?? undefined,
    accountId: accountId ?? undefined,
  });

  return c.json(templates);
});

// GET /templates/categories — list template categories
marketplace.get('/templates/categories', async (c) => {
  const categories = await templateService.getCategories();
  return c.json(categories);
});

// GET /templates/:slug — get template details with variable schema
marketplace.get('/templates/:slug', async (c) => {
  const slug = c.req.param('slug');

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
  });
});

// POST /deploy — deploy a template
const deploySchema = z.object({
  slug: z.string().min(1),
  config: z.record(z.string()).default({}),
  composeOverride: z.string().optional(),
  resourceOverrides: z.record(z.object({
    replicas: z.number().int().min(0).max(100).optional(),
    cpuLimit: z.number().int().min(0).optional(),
    memoryLimit: z.number().int().min(0).optional(),
  })).optional(),
});

marketplace.post('/deploy', deployRateLimit, requireMember, async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = deploySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { slug, config, composeOverride, resourceOverrides } = parsed.data;

  try {
    const result = await templateService.deployTemplate(slug, accountId, config, {
      composeOverride,
      resourceOverrides,
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

    logger.error({ err }, 'Template deployment failed');
    return c.json({ error: 'Failed to deploy template' }, 500);
  }
});

// POST /templates — create a custom template (admin or account-scoped)
const createTemplateSchema = z.object({
  slug: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  iconUrl: z.string().url().optional(),
  category: z.string().optional(),
  composeTemplate: z.string().min(1),
  isBuiltin: z.boolean().optional(),
});

marketplace.post('/templates', requireMember, async (c) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  // Only super users can create builtin templates
  const body = await c.req.json();
  const parsed = createTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  if (parsed.data.isBuiltin && !user.isSuper) {
    return c.json({ error: 'Only super users can create builtin templates' }, 403);
  }

  try {
    const template = await templateService.createTemplate({
      ...parsed.data,
      accountId: parsed.data.isBuiltin ? undefined : (accountId ?? undefined),
    });

    return c.json(template, 201);
  } catch (err) {
    logger.error({ err }, 'Template creation failed');
    return c.json({ error: 'Failed to create template' }, 500);
  }
});

// PATCH /templates/:slug — update a template
const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  iconUrl: z.string().url().optional(),
  category: z.string().optional(),
  composeTemplate: z.string().min(1).optional(),
});

marketplace.patch('/templates/:slug', requireMember, async (c) => {
  const user = c.get('user');
  const slug = c.req.param('slug');

  const template = await templateService.getTemplate(slug);

  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }

  // Only super users can update builtin templates
  if (template.isBuiltin && !user.isSuper) {
    return c.json({ error: 'Only super users can update builtin templates' }, 403);
  }

  const body = await c.req.json();
  const parsed = updateTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  try {
    const updated = await templateService.updateTemplate(template.id, parsed.data);
    return c.json(updated);
  } catch (err) {
    logger.error({ err }, 'Template update failed');
    return c.json({ error: 'Failed to update template' }, 500);
  }
});

// DELETE /templates/:slug — delete a template
marketplace.delete('/templates/:slug', requireMember, async (c) => {
  const user = c.get('user');
  const slug = c.req.param('slug');

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

  return c.json({ message: 'Template deleted' });
});

// POST /sync — sync builtin templates from disk (admin only)
marketplace.post('/sync', async (c) => {
  const user = c.get('user');

  if (!user.isSuper) {
    return c.json({ error: 'Only super users can sync templates' }, 403);
  }

  try {
    await templateService.syncBuiltinTemplates();
    return c.json({ message: 'Templates synced successfully' });
  } catch (err) {
    logger.error({ err }, 'Template sync failed');
    return c.json({ error: 'Failed to sync templates' }, 500);
  }
});

export default marketplace;
