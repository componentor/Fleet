import { Hono } from 'hono';
import { z } from 'zod';
import { db, platformSettings, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { emailService } from '../services/email.service.js';

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

settings.patch('/', async (c) => {
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

settings.patch('/stripe', async (c) => {
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

settings.patch('/email', async (c) => {
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

export default settings;
