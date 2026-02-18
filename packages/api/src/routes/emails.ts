import { Hono } from 'hono';
import { z } from 'zod';
import { db, emailTemplates, insertReturning, updateReturning, deleteReturning, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { emailService } from '../services/email.service.js';
import { requireMember } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';

const emails = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

emails.use('*', authMiddleware);
emails.use('*', tenantMiddleware);

// GET /templates — list email templates
// Returns DB templates merged with built-in defaults.
emails.get('/templates', async (c) => {
  const accountId = c.get('accountId');

  // Fetch all templates from DB, then filter in-memory
  const dbTemplates = await db.query.emailTemplates.findMany({
    orderBy: (t, { asc }) => asc(t.slug),
  });

  // Filter: show account-specific templates + global ones (accountId = null)
  const filtered = dbTemplates.filter(
    (t) => t.accountId === accountId || t.accountId === null,
  );

  // Merge with built-in defaults
  const defaults = emailService.getDefaultTemplates();
  const slugsInDb = new Set(filtered.map((t) => t.slug));

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
    ...filtered.map((t) => ({ ...t, isDefault: false })),
    ...defaultList,
  ];

  return c.json(result);
});

// GET /templates/:slug — get a specific template
emails.get('/templates/:slug', async (c) => {
  const accountId = c.get('accountId');
  const slug = c.req.param('slug');

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
});

// PATCH /templates/:slug — update a template
// Creates an account-specific override if the template only exists as default.
const updateTemplateSchema = z.object({
  subject: z.string().min(1).optional(),
  bodyHtml: z.string().min(1).optional(),
  variables: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

emails.patch('/templates/:slug', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const slug = c.req.param('slug');

  const body = await c.req.json();
  const parsed = updateTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const data = parsed.data;

  // Try to find existing template — prefer account-specific
  let existing = accountId
    ? await db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.slug, slug),
          eq(emailTemplates.accountId, accountId),
        ),
      })
    : null;

  if (!existing && user.isSuper && !accountId) {
    // Super admin editing global template
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
});

// POST /templates/:slug/test — send a test email
const testEmailSchema = z.object({
  to: z.string().email(),
  variables: z.record(z.string()).optional(),
});

emails.post('/templates/:slug/test', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const slug = c.req.param('slug');

  const body = await c.req.json();
  const parsed = testEmailSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { to, variables } = parsed.data;

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
});

// POST /templates/:slug/reset — reset template to default
// Deletes the account-specific override so the default is used again.
emails.post('/templates/:slug/reset', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const slug = c.req.param('slug');

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
});

export default emails;
