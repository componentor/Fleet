import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';
import { db, emailTemplates, insertReturning, updateReturning, deleteReturning, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { emailService } from '../services/email.service.js';
import { requireMember, requireAdmin } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';

const emails = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

emails.use('*', authMiddleware);
emails.use('*', tenantMiddleware);

// GET /templates/layout — get the shared email layout for preview
const getLayoutRoute = createRoute({
  method: 'get',
  path: '/templates/layout',
  tags: ['Emails'],
  summary: 'Get the email layout wrapper HTML',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({ html: z.string() }), 'Email layout HTML with {{__body__}} placeholder'),
    ...standardErrors,
  },
});

emails.openapi(getLayoutRoute, (async (c: any) => {
  return c.json({ html: emailService.getEmailLayout() });
}) as any);

// GET /templates — list email templates
// Returns DB templates merged with built-in defaults.
const listTemplatesRoute = createRoute({
  method: 'get',
  path: '/templates',
  tags: ['Emails'],
  summary: 'List email templates',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'List of email templates'),
    ...standardErrors,
  },
});

emails.openapi(listTemplatesRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  // Fetch all templates from DB, then filter in-memory
  const dbTemplates = await db.query.emailTemplates.findMany({
    orderBy: (t: any, { asc }: any) => asc(t.slug),
  });

  // Filter: show account-specific templates + global ones (accountId = null)
  const filtered = dbTemplates.filter(
    (t: any) => t.accountId === accountId || t.accountId === null,
  );

  // Merge with built-in defaults
  const defaults = emailService.getDefaultTemplates();
  const slugsInDb = new Set(filtered.map((t: any) => t.slug));

  const defaultList = Object.entries(defaults)
    .filter(([slug]) => !slugsInDb.has(slug))
    .map(([slug, tpl]) => ({
      id: null,
      slug,
      subject: tpl.subject,
      bodyHtml: tpl.bodyHtml,
      variables: tpl.variables,
      accountId: null,
      enabled: true,
      updatedAt: null,
      isDefault: true,
    }));

  const result = [
    ...filtered.map((t: any) => ({ ...t, isDefault: false })),
    ...defaultList,
  ];

  return c.json(result);
}) as any);

// GET /templates/:slug — get a specific template
const getTemplateRoute = createRoute({
  method: 'get',
  path: '/templates/{slug}',
  tags: ['Emails'],
  summary: 'Get a specific email template',
  security: bearerSecurity,
  request: {
    params: z.object({ slug: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Email template'),
    ...standardErrors,
  },
});

emails.openapi(getTemplateRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { slug } = c.req.valid('param');

  // Look for account override first
  let template = accountId
    ? await db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.slug, slug),
          eq(emailTemplates.accountId, accountId),
        ),
      })
    : null;

  // Then global template
  if (!template) {
    template = await db.query.emailTemplates.findFirst({
      where: and(
        eq(emailTemplates.slug, slug),
        isNull(emailTemplates.accountId),
      ),
    });
  }

  if (template) {
    return c.json({ ...template, isDefault: false });
  }

  // Check built-in defaults
  const defaults = emailService.getDefaultTemplates();
  const defaultTpl = defaults[slug];

  if (!defaultTpl) {
    return c.json({ error: 'Template not found' }, 404);
  }

  return c.json({
    id: null,
    slug,
    subject: defaultTpl.subject,
    bodyHtml: defaultTpl.bodyHtml,
    variables: defaultTpl.variables,
    accountId: null,
    enabled: true,
    updatedAt: null,
    isDefault: true,
  });
}) as any);

// PATCH /templates/:slug — update a template
// Creates an account-specific override if the template only exists as default.
const updateTemplateSchema = z.object({
  subject: z.string().min(1).optional(),
  bodyHtml: z.string().min(1).optional(),
  variables: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const patchTemplateRoute = createRoute({
  method: 'patch',
  path: '/templates/{slug}',
  tags: ['Emails'],
  summary: 'Update an email template',
  security: bearerSecurity,
  request: {
    params: z.object({ slug: z.string() }),
    body: jsonBody(updateTemplateSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated template'),
    201: jsonContent(z.any(), 'Created template override'),
  },
  middleware: [requireAdmin],
});

emails.openapi(patchTemplateRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const { slug } = c.req.valid('param');

  const data = c.req.valid('json');

  // Try to find existing template — prefer account-specific
  let existing = accountId
    ? await db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.slug, slug),
          eq(emailTemplates.accountId, accountId),
        ),
      })
    : null;

  if (!existing && user.isSuper) {
    // Super admin editing global template (even when an account is selected in sidebar)
    existing = await db.query.emailTemplates.findFirst({
      where: and(
        eq(emailTemplates.slug, slug),
        isNull(emailTemplates.accountId),
      ),
    });
  }

  if (existing) {
    // Update existing row
    const [updated] = await updateReturning(emailTemplates, {
      ...data,
      updatedAt: new Date(),
    }, eq(emailTemplates.id, existing.id));

    return c.json(updated);
  }

  // Check if it is a known default — if so, create a new override row
  const defaults = emailService.getDefaultTemplates();
  const defaultTpl = defaults[slug];

  if (!defaultTpl && !data.subject && !data.bodyHtml) {
    return c.json({ error: 'Template not found' }, 404);
  }

  // Create new template row (account override or new global)
  const [created] = await insertReturning(emailTemplates, {
    slug,
    subject: data.subject ?? defaultTpl?.subject ?? slug,
    bodyHtml: data.bodyHtml ?? defaultTpl?.bodyHtml ?? '',
    variables: data.variables ?? defaultTpl?.variables ?? [],
    accountId: accountId ?? null,
    enabled: data.enabled ?? true,
  });

  return c.json(created, 201);
}) as any);

// POST /templates/:slug/test — send a test email
const testEmailSchema = z.object({
  to: z.string().email(),
  variables: z.record(z.string(), z.string()).optional(),
});

const testEmailRoute = createRoute({
  method: 'post',
  path: '/templates/{slug}/test',
  tags: ['Emails'],
  summary: 'Send a test email',
  security: bearerSecurity,
  request: {
    params: z.object({ slug: z.string() }),
    body: jsonBody(testEmailSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Test email sent'),
    ...standardErrors,
  },
  middleware: [requireAdmin],
});

emails.openapi(testEmailRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { slug } = c.req.valid('param');

  const data = c.req.valid('json');
  const { to, variables } = data;

  // Build sample variables by merging defaults with provided overrides
  const defaults = emailService.getDefaultTemplates();
  const defaultTpl = defaults[slug];
  const sampleVars: Record<string, string> = {};

  if (defaultTpl) {
    for (const key of defaultTpl.variables) {
      sampleVars[key] = `[${key}]`;
    }
  }

  // Override with user-provided variables
  if (variables) {
    Object.assign(sampleVars, variables);
  }

  try {
    const result = await emailService.sendTemplateEmail(
      slug,
      to,
      sampleVars,
      accountId,
    );

    return c.json({
      message: 'Test email sent',
      messageId: result.messageId,
      to,
      slug,
    });
  } catch (err) {
    logger.error({ err }, 'Test email failed');
    return c.json(
      {
        error: 'Failed to send test email',
      },
      500,
    );
  }
}) as any);

// POST /templates/:slug/reset — reset template to default
// Deletes the account-specific override so the default is used again.
const resetTemplateRoute = createRoute({
  method: 'post',
  path: '/templates/{slug}/reset',
  tags: ['Emails'],
  summary: 'Reset email template to default',
  security: bearerSecurity,
  request: {
    params: z.object({ slug: z.string() }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Template reset'),
    ...standardErrors,
  },
  middleware: [requireAdmin],
});

emails.openapi(resetTemplateRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const { slug } = c.req.valid('param');

  const defaults = emailService.getDefaultTemplates();

  if (!defaults[slug]) {
    return c.json({ error: 'No default template exists for this slug' }, 404);
  }

  if (accountId) {
    // Delete account-specific override
    const deleted = await deleteReturning(
      emailTemplates,
      and(
        eq(emailTemplates.slug, slug),
        eq(emailTemplates.accountId, accountId),
      )!,
    );

    if (deleted.length === 0) {
      return c.json({ message: 'Template is already using the default' });
    }

    return c.json({ message: 'Template reset to default', slug });
  }

  // Super admin resetting global template
  if (user.isSuper) {
    const deleted = await deleteReturning(
      emailTemplates,
      and(
        eq(emailTemplates.slug, slug),
        isNull(emailTemplates.accountId),
      )!,
    );

    if (deleted.length === 0) {
      return c.json({ message: 'Template is already using the built-in default' });
    }

    return c.json({ message: 'Global template reset to built-in default', slug });
  }

  return c.json({ error: 'Cannot reset without account context' }, 400);
}) as any);

// POST /templates/reseed — reset all (or one) template(s) to built-in defaults
// Deletes global DB rows so built-in defaults take over.
const reseedTemplatesRoute = createRoute({
  method: 'post',
  path: '/templates/reseed',
  tags: ['Emails'],
  summary: 'Re-seed email templates to built-in defaults',
  security: bearerSecurity,
  request: {
    body: jsonBody(z.object({
      slug: z.string().optional(),
    }).optional()),
  },
  responses: {
    200: jsonContent(z.any(), 'Templates re-seeded'),
    ...standardErrors,
  },
  middleware: [requireAdmin],
});

emails.openapi(reseedTemplatesRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can re-seed templates' }, 403);
  }

  const body = c.req.valid('json') ?? {};
  const defaults = emailService.getDefaultTemplates();
  const slugsToReseed = body.slug ? [body.slug] : Object.keys(defaults);

  let reset = 0;
  for (const slug of slugsToReseed) {
    if (!defaults[slug]) continue;
    const deleted = await deleteReturning(
      emailTemplates,
      and(
        eq(emailTemplates.slug, slug),
        isNull(emailTemplates.accountId),
      )!,
    );
    if (deleted.length > 0) reset++;
  }

  return c.json({
    message: body.slug
      ? reset > 0 ? `Template "${body.slug}" re-seeded to default` : `Template "${body.slug}" is already using the default`
      : `Re-seeded ${reset} template(s) to built-in defaults`,
    reset,
    total: slugsToReseed.length,
  });
}) as any);

export default emails;
