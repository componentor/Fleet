import { Hono } from 'hono';
import { z } from 'zod';
import { db, platformSettings, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { emailService } from '../services/email.service.js';
import { requireAdmin } from '../middleware/rbac.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { encrypt } from '../services/crypto.service.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../services/logger.js';

const settingsRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 30, keyPrefix: 'settings' });

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
// Shared helper: resolve the platform root domain (DB → env → fallback)
// ────────────────────────────────────────────────────────────────────────────
export async function getPlatformDomain(): Promise<string> {
  // Env var takes priority (set at deploy time, cannot be accidentally cleared via UI)
  if (process.env['PLATFORM_DOMAIN']) return process.env['PLATFORM_DOMAIN'];

  try {
    const dbVal = await getSetting('platform:domain');
    if (dbVal != null) {
      // setup.ts stores it JSON-stringified; handle both formats
      const parsed = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal;
      if (typeof parsed === 'string' && parsed.length > 0) return parsed;
    }
  } catch {
    // DB may not be available
  }

  return 'fleet.local';
}

// ────────────────────────────────────────────────────────────────────────────
// GET /platform-domain — lightweight endpoint for any authenticated user.
// Returns the bare root domain for connection guides, SFTP, webhooks, etc.
// ────────────────────────────────────────────────────────────────────────────
settings.get('/platform-domain', cache(600), async (c) => {
  const domain = await getPlatformDomain();
  return c.json({ domain: domain === 'fleet.local' ? null : domain });
});

// ────────────────────────────────────────────────────────────────────────────
// GET / — get settings
// Super user with no account context: returns platform-wide settings.
// Account context: returns account-scoped settings.
// ────────────────────────────────────────────────────────────────────────────
settings.get('/', cache(300), async (c) => {
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

const ALLOWED_ACCOUNT_SETTINGS = [
  'notifications', 'timezone', 'language', 'theme',
  'billing:plan', 'email:provider', 'email:smtpHost', 'email:smtpPort',
  'email:smtpUser', 'email:smtpPass', 'email:smtpFrom',
  'email:resendApiKey', 'email:resendFrom',
];

settings.patch('/', settingsRateLimit, requireAdmin, async (c) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  const body = await c.req.json();
  const parsed = updateSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
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

    logger.info({ keys: entries.map(([k]) => k), changedBy: user.userId }, 'Platform settings updated');
    return c.json({ message: 'Platform settings updated', updated: entries.map(([k]) => k) });
  }

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Account-scoped settings — validate keys against allowlist
  const disallowedKeys = entries
    .map(([k]) => k)
    .filter((k) => !ALLOWED_ACCOUNT_SETTINGS.includes(k));

  if (disallowedKeys.length > 0) {
    return c.json({ error: 'Disallowed setting keys', keys: disallowedKeys }, 403);
  }

  for (const [key, value] of entries) {
    await upsertSetting(`account:${accountId}:${key}`, value);
  }

  await invalidateCache('GET:/settings/*');

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

settings.patch('/stripe', settingsRateLimit, requireAdmin, async (c) => {
  const user = c.get('user');

  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure Stripe' }, 403);
  }

  const body = await c.req.json();
  const parsed = stripeSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const data = parsed.data;

  await upsertSetting('stripe:publishableKey', data.publishableKey); // publishable key is public, no need to encrypt
  await upsertSetting('stripe:secretKey', encrypt(data.secretKey));

  if (data.webhookSecret) {
    await upsertSetting('stripe:webhookSecret', encrypt(data.webhookSecret));
  }

  logger.info({ changedBy: user.userId }, 'Stripe configuration updated');
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

settings.patch('/email', settingsRateLimit, requireAdmin, async (c) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  const body = await c.req.json();
  const parsed = emailSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
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
      await upsertSetting('email:smtpPass', encrypt(data.smtpPass));
    }
    if (data.smtpFrom !== undefined) {
      await upsertSetting('email:smtpFrom', data.smtpFrom);
    }
    if (data.resendApiKey !== undefined) {
      await upsertSetting('email:resendApiKey', encrypt(data.resendApiKey));
    }
    if (data.resendFrom !== undefined) {
      await upsertSetting('email:resendFrom', data.resendFrom);
    }

    // Reset the cached email provider so the next send picks up new config
    emailService.resetProvider();

    logger.info({ changedBy: user.userId }, 'Email configuration updated');
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
  sandbox: z.boolean().optional(),
});

settings.patch('/registrar', settingsRateLimit, requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure registrar' }, 403);
  }

  const body = await c.req.json();
  const parsed = registrarSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { provider, apiKey, apiSecret, resellerId, sandbox } = parsed.data;
  const { domainRegistrars, eq: eqOp, insertReturning, updateReturning } = await import('@fleet/db');

  const existing = await db.query.domainRegistrars.findFirst({
    where: eqOp(domainRegistrars.enabled, true),
  });

  const config: Record<string, string> = {};
  if (resellerId) config['resellerId'] = resellerId;
  if (sandbox !== undefined) config['sandbox'] = String(sandbox);

  if (existing) {
    const [updated] = await updateReturning(domainRegistrars, {
      provider,
      apiKey: encrypt(apiKey),
      apiSecret: apiSecret ? encrypt(apiSecret) : null,
      config,
    }, eqOp(domainRegistrars.id, existing.id));
    // Reset provider cache
    const { registrarService } = await import('../services/registrar.service.js');
    registrarService.resetProvider();
    return c.json({ message: 'Registrar updated', id: updated?.id });
  }

  const [created] = await insertReturning(domainRegistrars, {
    provider,
    apiKey: encrypt(apiKey),
    apiSecret: apiSecret ? encrypt(apiSecret) : null,
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
    return c.json({ success: false, error: 'Registrar connection test failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /github — get configured GitHub OAuth credentials
// ────────────────────────────────────────────────────────────────────────────
settings.get('/github', requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can view GitHub config' }, 403);
  }

  const clientId = await getSetting('github:clientId');
  const clientSecret = await getSetting('github:clientSecret');
  const webhookSecret = await getSetting('github:webhookSecret');

  return c.json({
    configured: !!(clientId || process.env['GITHUB_CLIENT_ID']),
    clientId: (clientId as string) || process.env['GITHUB_CLIENT_ID'] || '',
    clientSecretSet: !!(clientSecret || process.env['GITHUB_CLIENT_SECRET']),
    webhookSecretSet: !!(webhookSecret || process.env['GITHUB_WEBHOOK_SECRET']),
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /github — configure GitHub OAuth credentials
// ────────────────────────────────────────────────────────────────────────────
const githubSettingsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  webhookSecret: z.string().min(1).optional(),
});

settings.patch('/github', settingsRateLimit, requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure GitHub' }, 403);
  }

  const body = await c.req.json();
  const parsed = githubSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const data = parsed.data;

  await upsertSetting('github:clientId', data.clientId);
  await upsertSetting('github:clientSecret', encrypt(data.clientSecret));

  if (data.webhookSecret) {
    await upsertSetting('github:webhookSecret', encrypt(data.webhookSecret));
  }

  // Invalidate cached config so the new values take effect immediately
  const { invalidateGitHubConfigCache } = await import('../services/github.service.js');
  invalidateGitHubConfigCache();

  logger.info({ changedBy: user.userId }, 'GitHub configuration updated');
  return c.json({ message: 'GitHub configuration updated' });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /google — get configured Google OAuth credentials
// ────────────────────────────────────────────────────────────────────────────
settings.get('/google', requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can view Google config' }, 403);
  }

  const clientId = await getSetting('google:clientId');
  const clientSecret = await getSetting('google:clientSecret');

  return c.json({
    configured: !!(clientId || process.env['GOOGLE_CLIENT_ID']),
    clientId: (clientId as string) || process.env['GOOGLE_CLIENT_ID'] || '',
    clientSecretSet: !!(clientSecret || process.env['GOOGLE_CLIENT_SECRET']),
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /google — configure Google OAuth credentials
// ────────────────────────────────────────────────────────────────────────────
const googleSettingsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

settings.patch('/google', settingsRateLimit, requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure Google' }, 403);
  }

  const body = await c.req.json();
  const parsed = googleSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const data = parsed.data;

  await upsertSetting('google:clientId', data.clientId);
  await upsertSetting('google:clientSecret', encrypt(data.clientSecret));

  // Invalidate cached config so the new values take effect immediately
  const { invalidateGoogleConfigCache } = await import('../services/google.service.js');
  invalidateGoogleConfigCache();

  logger.info({ changedBy: user.userId }, 'Google configuration updated');
  return c.json({ message: 'Google configuration updated' });
});

export default settings;
