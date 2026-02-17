import { Hono } from 'hono';
import { z } from 'zod';
import { db, platformSettings, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { emailService } from '../services/email.service.js';
import { requireAdmin } from '../middleware/rbac.js';

const settings = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

settings.use('*', authMiddleware);
settings.use('*', tenantMiddleware);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<unknown | null> {
  const row = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, key),
  });
  return row?.value ?? null;
}

async function upsertSetting(key: string, value: unknown): Promise<void> {
  const existing = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, key),
  });

  if (existing) {
    await db
      .update(platformSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(platformSettings.id, existing.id));
  } else {
    await db.insert(platformSettings).values({ key, value });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// GET / — get settings
// Super user with no account context: returns platform-wide settings.
// Account context: returns account-scoped settings.
// ────────────────────────────────────────────────────────────────────────────
settings.get('/', async (c) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  if (user.isSuper && !accountId) {
    // Platform-wide settings
    const rows = await db.query.platformSettings.findMany({
      orderBy: (s, { asc }) => asc(s.key),
    });

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }

    return c.json(result);
  }

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Account-scoped settings are stored with a key prefix
  const rows = await db.query.platformSettings.findMany({
    orderBy: (s, { asc }) => asc(s.key),
  });

  const prefix = `account:${accountId}:`;
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.key.startsWith(prefix)) {
      result[row.key.slice(prefix.length)] = row.value;
    }
  }

  return c.json(result);
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH / — update settings
// ────────────────────────────────────────────────────────────────────────────
const updateSettingsSchema = z.record(z.unknown());

settings.patch('/', requireAdmin, async (c) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  const body = await c.req.json();
  const parsed = updateSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const entries = Object.entries(parsed.data);

  if (entries.length === 0) {
    return c.json({ error: 'No settings provided' }, 400);
  }

  if (user.isSuper && !accountId) {
    // Platform settings — only super admins
    for (const [key, value] of entries) {
      await upsertSetting(key, value);
    }

    return c.json({ message: 'Platform settings updated', updated: entries.map(([k]) => k) });
  }

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Account-scoped settings
  for (const [key, value] of entries) {
    await upsertSetting(`account:${accountId}:${key}`, value);
  }

  return c.json({ message: 'Account settings updated', updated: entries.map(([k]) => k) });
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /stripe — configure Stripe keys
// Only super admins can set the platform Stripe keys.
// ────────────────────────────────────────────────────────────────────────────
const stripeSettingsSchema = z.object({
  publishableKey: z.string().min(1),
  secretKey: z.string().min(1),
  webhookSecret: z.string().min(1).optional(),
});

settings.patch('/stripe', requireAdmin, async (c) => {
  const user = c.get('user');

  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure Stripe' }, 403);
  }

  const body = await c.req.json();
  const parsed = stripeSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;

  await upsertSetting('stripe:publishableKey', data.publishableKey);
  await upsertSetting('stripe:secretKey', data.secretKey);

  if (data.webhookSecret) {
    await upsertSetting('stripe:webhookSecret', data.webhookSecret);
  }

  return c.json({ message: 'Stripe configuration updated' });
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /email — configure email provider
// Super admins can set the global email provider.
// Account admins can set account-level email settings.
// ────────────────────────────────────────────────────────────────────────────
const emailSettingsSchema = z.object({
  provider: z.enum(['smtp', 'resend']).optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFrom: z.string().email().optional(),
  resendApiKey: z.string().optional(),
  resendFrom: z.string().email().optional(),
});

settings.patch('/email', requireAdmin, async (c) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  const body = await c.req.json();
  const parsed = emailSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;

  if (user.isSuper && !accountId) {
    // Platform-level email config
    if (data.provider) {
      await upsertSetting('email:provider', data.provider);
    }
    if (data.smtpHost !== undefined) {
      await upsertSetting('email:smtpHost', data.smtpHost);
    }
    if (data.smtpPort !== undefined) {
      await upsertSetting('email:smtpPort', data.smtpPort);
    }
    if (data.smtpUser !== undefined) {
      await upsertSetting('email:smtpUser', data.smtpUser);
    }
    if (data.smtpPass !== undefined) {
      await upsertSetting('email:smtpPass', data.smtpPass);
    }
    if (data.smtpFrom !== undefined) {
      await upsertSetting('email:smtpFrom', data.smtpFrom);
    }
    if (data.resendApiKey !== undefined) {
      await upsertSetting('email:resendApiKey', data.resendApiKey);
    }
    if (data.resendFrom !== undefined) {
      await upsertSetting('email:resendFrom', data.resendFrom);
    }

    // Reset the cached email provider so the next send picks up new config
    emailService.resetProvider();

    return c.json({ message: 'Email configuration updated' });
  }

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Account-level email config
  const prefix = `account:${accountId}:email`;
  if (data.smtpFrom !== undefined) {
    await upsertSetting(`${prefix}:smtpFrom`, data.smtpFrom);
  }
  if (data.resendFrom !== undefined) {
    await upsertSetting(`${prefix}:resendFrom`, data.resendFrom);
  }

  return c.json({ message: 'Account email configuration updated' });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /registrar — get configured domain registrar
// ────────────────────────────────────────────────────────────────────────────
settings.get('/registrar', requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can view registrar config' }, 403);
  }

  const { domainRegistrars, eq: eqOp } = await import('@fleet/db');
  const registrar = await db.query.domainRegistrars.findFirst({
    where: eqOp(domainRegistrars.enabled, true),
  });

  if (!registrar) {
    return c.json({ configured: false });
  }

  return c.json({
    configured: true,
    id: registrar.id,
    provider: registrar.provider,
    config: registrar.config,
    // Mask the API key
    apiKeyMasked: registrar.apiKey ? `${registrar.apiKey.slice(0, 4)}...${registrar.apiKey.slice(-4)}` : null,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /registrar — create/update domain registrar
// ────────────────────────────────────────────────────────────────────────────
const registrarSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
  resellerId: z.string().optional(),
});

settings.patch('/registrar', requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure registrar' }, 403);
  }

  const body = await c.req.json();
  const parsed = registrarSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { provider, apiKey, apiSecret, resellerId } = parsed.data;
  const { domainRegistrars, eq: eqOp, insertReturning, updateReturning } = await import('@fleet/db');

  const existing = await db.query.domainRegistrars.findFirst({
    where: eqOp(domainRegistrars.enabled, true),
  });

  const config = resellerId ? { resellerId } : {};

  if (existing) {
    const [updated] = await updateReturning(domainRegistrars, {
      provider,
      apiKey,
      apiSecret: apiSecret ?? null,
      config,
    }, eqOp(domainRegistrars.id, existing.id));
    // Reset provider cache
    const { registrarService } = await import('../services/registrar.service.js');
    registrarService.resetProvider();
    return c.json({ message: 'Registrar updated', id: updated?.id });
  }

  const [created] = await insertReturning(domainRegistrars, {
    provider,
    apiKey,
    apiSecret: apiSecret ?? null,
    config,
    enabled: true,
    createdBy: user.userId,
  });

  const { registrarService } = await import('../services/registrar.service.js');
  registrarService.resetProvider();

  return c.json({ message: 'Registrar configured', id: created?.id }, 201);
});

// ────────────────────────────────────────────────────────────────────────────
// POST /registrar/test — test registrar connection
// ────────────────────────────────────────────────────────────────────────────
settings.post('/registrar/test', requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can test registrar' }, 403);
  }

  try {
    const { registrarService } = await import('../services/registrar.service.js');
    const provider = await registrarService.getProvider();
    const results = await provider.searchDomains('test', ['com']);
    return c.json({ success: true, provider: provider.name, results: results.length });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default settings;
