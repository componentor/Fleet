import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, platformSettings, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { emailService } from '../services/email.service.js';
import { requireAdmin } from '../middleware/rbac.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { encrypt, decrypt } from '../services/crypto.service.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { join } from 'node:path';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';
import { dockerService } from '../services/docker.service.js';

const UPLOAD_BASE = process.env['UPLOAD_BASE_PATH']
  ?? (process.env['NODE_ENV'] === 'production' ? '/srv/nfs/uploads' : join(process.cwd(), 'data', 'uploads'));
const BRANDING_DIR = join(UPLOAD_BASE, 'platform', 'branding');

const settingsRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 30, keyPrefix: 'settings' });

const settings = new OpenAPIHono<{
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

/**
 * Decrypt a stored secret and return first 3 chars + bullet dots.
 * Returns null if the value is not set.
 */
function maskSecret(encryptedValue: unknown): string | null {
  if (encryptedValue == null || typeof encryptedValue !== 'string' || encryptedValue.length === 0) return null;
  try {
    const plain = decrypt(encryptedValue);
    if (plain.length <= 3) return '\u2022\u2022\u2022';
    return plain.slice(0, 3) + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
  } catch {
    return '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
  }
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

/**
 * Update Traefik labels on fleet_api and fleet_dashboard Docker Swarm services
 * so Traefik routes the new domain and requests a Let's Encrypt certificate.
 */
async function updateFleetServiceDomain(newDomain: string): Promise<void> {
  const serviceConfigs = [
    {
      name: 'fleet_api',
      router: 'api',
      rule: `Host(\`${newDomain}\`) && PathPrefix(\`/api\`)`,
      port: 3000,
    },
    {
      name: 'fleet_dashboard',
      router: 'dashboard',
      rule: `Host(\`${newDomain}\`)`,
      port: 80,
      extraLabels: { 'traefik.http.routers.dashboard.priority': '1' },
    },
  ];

  for (const cfg of serviceConfigs) {
    const services = await dockerService.listServices({ name: [cfg.name] });
    const svc = services.find((s: any) => s.Spec?.Name === cfg.name);
    if (!svc) {
      logger.warn({ service: cfg.name }, `${cfg.name} not found — skipping Traefik label update`);
      continue;
    }

    const labels: Record<string, string> = {
      'traefik.enable': 'true',
      [`traefik.http.routers.${cfg.router}.rule`]: cfg.rule,
      [`traefik.http.routers.${cfg.router}.entrypoints`]: 'websecure',
      [`traefik.http.routers.${cfg.router}.tls.certresolver`]: 'letsencrypt',
      [`traefik.http.services.${cfg.router}.loadbalancer.server.port`]: String(cfg.port),
      ...cfg.extraLabels,
    };

    await dockerService.updateService((svc as any).ID, { labels });
    logger.info({ service: cfg.name, domain: newDomain }, `Updated Traefik labels on ${cfg.name}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Shared helper: resolve the platform root domain (DB → env → fallback)
// ────────────────────────────────────────────────────────────────────────────
export async function getPlatformDomain(): Promise<string> {
  // DB takes priority — the admin may have updated the domain via the settings UI
  try {
    const dbVal = await getSetting('platform:domain');
    if (dbVal != null) {
      // setup.ts stores it JSON-stringified; handle both formats
      const parsed = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal;
      if (typeof parsed === 'string' && parsed.length > 0) return parsed;
    }
  } catch {
    // DB may not be available — fall through to env
  }

  // Env var as fallback (set at deploy time)
  if (process.env['PLATFORM_DOMAIN']) return process.env['PLATFORM_DOMAIN'];

  return 'fleet.local';
}

// ────────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────────

const updateSettingsSchema = z.record(z.string(), z.unknown());

const stripeSettingsSchema = z.object({
  publishableKey: z.string().min(1).optional(),
  secretKey: z.string().min(1).optional(),
  webhookSecret: z.string().min(1).optional(),
});

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

const registrarSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().optional(),
  resellerId: z.string().optional(),
  sandbox: z.boolean().optional(),
});

const githubSettingsSchema = z.object({
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  webhookSecret: z.string().min(1).optional(),
});

const googleSettingsSchema = z.object({
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
});

const translationSettingsSchema = z.object({
  provider: z.enum(['deepl', 'claude']).optional(),
  deeplApiKey: z.string().min(1).optional(),
  claudeApiKey: z.string().min(1).optional(),
});

const brandingTypeParamSchema = z.object({
  type: z.string().openapi({ description: 'Branding asset type (logo or favicon)' }),
});

const ALLOWED_ACCOUNT_SETTINGS = [
  'notifications', 'timezone', 'language', 'theme',
  'billing:plan', 'email:provider', 'email:smtpHost', 'email:smtpPort',
  'email:smtpUser', 'email:smtpPass', 'email:smtpFrom',
  'email:resendApiKey', 'email:resendFrom',
];

// ────────────────────────────────────────────────────────────────────────────
// Route definitions
// ────────────────────────────────────────────────────────────────────────────

const getPlatformDomainRoute = createRoute({
  method: 'get',
  path: '/platform-domain',
  tags: ['Settings'],
  summary: 'Get the platform root domain',
  security: bearerSecurity,
  middleware: [cache(600)] as const,
  responses: {
    200: jsonContent(z.object({ domain: z.string().nullable() }), 'Platform domain'),
    ...standardErrors,
  },
});

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Settings'],
  summary: 'Get settings (platform-wide or account-scoped)',
  security: bearerSecurity,
  middleware: [cache(300)] as const,
  responses: {
    200: jsonContent(z.any(), 'Settings object'),
    ...standardErrors,
  },
});

const updateSettingsRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: ['Settings'],
  summary: 'Update settings (platform-wide or account-scoped)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(updateSettingsSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Settings updated'),
  },
});

const getStripeRoute = createRoute({
  method: 'get',
  path: '/stripe',
  tags: ['Settings'],
  summary: 'Get configured Stripe keys (super admin only)',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'Stripe configuration'),
    ...standardErrors,
  },
});

const updateStripeRoute = createRoute({
  method: 'patch',
  path: '/stripe',
  tags: ['Settings'],
  summary: 'Configure Stripe keys (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(stripeSettingsSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Stripe configuration updated'),
  },
});

const testStripeRoute = createRoute({
  method: 'post',
  path: '/stripe/test',
  tags: ['Settings'],
  summary: 'Test Stripe API connection (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  responses: {
    200: jsonContent(z.object({ success: z.boolean(), message: z.string(), accountName: z.string().optional() }), 'Stripe test result'),
    ...standardErrors,
  },
});

const updateEmailRoute = createRoute({
  method: 'patch',
  path: '/email',
  tags: ['Settings'],
  summary: 'Configure email provider',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(emailSettingsSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Email configuration updated'),
  },
});

const testEmailRoute = createRoute({
  method: 'post',
  path: '/email/test',
  tags: ['Settings'],
  summary: 'Send a test email (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(z.object({
      to: z.string().email(),
    })),
  },
  responses: {
    200: jsonContent(z.object({ success: z.boolean(), message: z.string() }), 'Test email result'),
    ...standardErrors,
  },
});

const getRegistrarRoute = createRoute({
  method: 'get',
  path: '/registrar',
  tags: ['Settings'],
  summary: 'Get configured domain registrar',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'Registrar configuration'),
    ...standardErrors,
  },
});

const updateRegistrarRoute = createRoute({
  method: 'patch',
  path: '/registrar',
  tags: ['Settings'],
  summary: 'Create or update domain registrar (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(registrarSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Registrar updated'),
    201: jsonContent(z.any(), 'Registrar configured'),
  },
});

const testRegistrarRoute = createRoute({
  method: 'post',
  path: '/registrar/test',
  tags: ['Settings'],
  summary: 'Test registrar connection (super admin only)',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'Registrar connection test result'),
    ...standardErrors,
  },
});

const getGithubRoute = createRoute({
  method: 'get',
  path: '/github',
  tags: ['Settings'],
  summary: 'Get configured GitHub OAuth credentials',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'GitHub configuration'),
    ...standardErrors,
  },
});

const updateGithubRoute = createRoute({
  method: 'patch',
  path: '/github',
  tags: ['Settings'],
  summary: 'Configure GitHub OAuth credentials (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(githubSettingsSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'GitHub configuration updated'),
  },
});

const getGoogleRoute = createRoute({
  method: 'get',
  path: '/google',
  tags: ['Settings'],
  summary: 'Get configured Google OAuth credentials',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'Google configuration'),
    ...standardErrors,
  },
});

const updateGoogleRoute = createRoute({
  method: 'patch',
  path: '/google',
  tags: ['Settings'],
  summary: 'Configure Google OAuth credentials (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(googleSettingsSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Google configuration updated'),
  },
});

const uploadBrandingRoute = createRoute({
  method: 'post',
  path: '/branding',
  tags: ['Settings'],
  summary: 'Upload logo, favicon, or set title (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Branding updated'),
  },
});

const getBrandingRoute = createRoute({
  method: 'get',
  path: '/branding',
  tags: ['Settings'],
  summary: 'Get current branding settings (super admin only)',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'Branding configuration'),
    ...standardErrors,
  },
});

const deleteBrandingRoute = createRoute({
  method: 'delete',
  path: '/branding/{type}',
  tags: ['Settings'],
  summary: 'Remove a branding asset (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    params: brandingTypeParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Branding asset removed'),
  },
});

const getTranslationRoute = createRoute({
  method: 'get',
  path: '/translation',
  tags: ['Settings'],
  summary: 'Get translation service configuration (super admin only)',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'Translation configuration'),
    ...standardErrors,
  },
});

const updateTranslationRoute = createRoute({
  method: 'patch',
  path: '/translation',
  tags: ['Settings'],
  summary: 'Configure translation service (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(translationSettingsSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Translation configuration updated'),
  },
});

const testTranslationRoute = createRoute({
  method: 'post',
  path: '/translation/test',
  tags: ['Settings'],
  summary: 'Test DeepL API connection (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  responses: {
    200: jsonContent(z.object({ success: z.boolean(), message: z.string(), characterCount: z.number().optional(), characterLimit: z.number().optional() }), 'DeepL test result'),
    ...standardErrors,
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Handlers
// ────────────────────────────────────────────────────────────────────────────

// GET /platform-domain
settings.openapi(getPlatformDomainRoute, (async (c: any) => {
  const domain = await getPlatformDomain();
  return c.json({ domain: domain === 'fleet.local' ? null : domain });
}) as any);

// GET /
settings.openapi(getSettingsRoute, (async (c: any) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  // Mask sensitive values — show first 3 chars hint instead of full encrypted blob
  const SENSITIVE_PATTERNS = ['secret', 'password', 'apikey', 'token', 'private'];
  const isSensitive = (key: string): boolean => {
    const lower = key.toLowerCase();
    return SENSITIVE_PATTERNS.some((p) => lower.includes(p));
  };

  if (user.isSuper) {
    // Super admins always get platform-wide settings (they need them for the Settings page
    // even when an account is selected in the sidebar)
    const rows = await db.query.platformSettings.findMany({
      orderBy: (s: any, { asc }: any) => asc(s.key),
    });

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      // Skip account-scoped keys — only return platform keys
      if (row.key.startsWith('account:')) continue;
      result[row.key] = isSensitive(row.key) && row.value != null ? (maskSecret(row.value) ?? '••••••••') : row.value;
    }

    // Also merge in account-scoped settings if an account is selected
    if (accountId) {
      const prefix = `account:${accountId}:`;
      for (const row of rows) {
        if (row.key.startsWith(prefix)) {
          result[row.key.slice(prefix.length)] = row.value;
        }
      }
    }

    return c.json(result);
  }

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Account-scoped settings are stored with a key prefix
  const rows = await db.query.platformSettings.findMany({
    orderBy: (s: any, { asc }: any) => asc(s.key),
  });

  const prefix = `account:${accountId}:`;
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.key.startsWith(prefix)) {
      result[row.key.slice(prefix.length)] = row.value;
    }
  }

  return c.json(result);
}) as any);

// PATCH /
settings.openapi(updateSettingsRoute, (async (c: any) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  const data = c.req.valid('json');
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return c.json({ error: 'No settings provided' }, 400);
  }

  // Allowlist for platform setting keys to prevent arbitrary setting injection
  const ALLOWED_PLATFORM_PREFIXES = [
    'platform:', 'billing:', 'email:', 'notifications:', 'branding:',
    'github:', 'google:', 'registrar:', 'storage:', 'domain:', 'limits:', 'reseller:',
    'updates:', 'support:', 'translation:', 'i18n:', 'selfhealing:',
  ];

  // Detect if any keys are platform-scoped (super admin settings page sends platform:* keys even with an account selected)
  const isPlatformUpdate = user.isSuper && entries.some(([k]) => ALLOWED_PLATFORM_PREFIXES.some((p) => k.startsWith(p)));

  if (isPlatformUpdate) {
    // Platform settings — only super admins
    const disallowedPlatformKeys = entries
      .map(([k]) => k)
      .filter((k) => !ALLOWED_PLATFORM_PREFIXES.some((p) => k.startsWith(p)));

    if (disallowedPlatformKeys.length > 0) {
      return c.json({ error: 'Disallowed platform setting keys', keys: disallowedPlatformKeys }, 403);
    }

    for (const [key, value] of entries) {
      await upsertSetting(key, value);
    }

    await invalidateCache('GET:/settings/*');

    // If the platform domain changed, update Traefik labels on fleet_api and fleet_dashboard
    // so Traefik requests a new Let's Encrypt cert for the new domain.
    const domainEntry = entries.find(([k]) => k === 'platform:domain');
    if (domainEntry) {
      const rawDomain = domainEntry[1];
      const newDomain = typeof rawDomain === 'string'
        ? (rawDomain.startsWith('"') ? JSON.parse(rawDomain) : rawDomain)
        : String(rawDomain);

      if (newDomain && newDomain.length > 0) {
        try {
          await updateFleetServiceDomain(newDomain);
          logger.info({ newDomain, changedBy: user.userId }, 'Fleet service Traefik labels updated for new domain');
        } catch (err) {
          logger.error({ err, newDomain }, 'Failed to update fleet service Traefik labels — manual service update may be needed');
          logToErrorTable({ level: 'warn', message: `Traefik label update failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'settings', operation: 'traefik-label-update' } });
        }
      }
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
}) as any);

// GET /stripe
settings.openapi(getStripeRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can view Stripe config' }, 403);
  }

  const publishableKey = await getSetting('stripe:publishableKey');
  const secretKey = await getSetting('stripe:secretKey');
  const webhookSecret = await getSetting('stripe:webhookSecret');

  return c.json({
    configured: !!(publishableKey && secretKey),
    publishableKey: (publishableKey as string) || '',
    secretKeyHint: maskSecret(secretKey),
    webhookSecretHint: maskSecret(webhookSecret),
  });
}) as any);

// PATCH /stripe
settings.openapi(updateStripeRoute, (async (c: any) => {
  const user = c.get('user');

  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure Stripe' }, 403);
  }

  const data = c.req.valid('json');

  if (data.publishableKey) {
    await upsertSetting('stripe:publishableKey', data.publishableKey);
  }
  if (data.secretKey) {
    await upsertSetting('stripe:secretKey', encrypt(data.secretKey));
  }
  if (data.webhookSecret) {
    await upsertSetting('stripe:webhookSecret', encrypt(data.webhookSecret));
  }

  await invalidateCache('GET:/settings/*');
  logger.info({ changedBy: user.userId }, 'Stripe configuration updated');
  return c.json({ message: 'Stripe configuration updated' });
}) as any);

// POST /stripe/test — test Stripe API connection
settings.openapi(testStripeRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can test Stripe' }, 403);
  }

  const encryptedKey = await getSetting('stripe:secretKey');
  if (!encryptedKey || typeof encryptedKey !== 'string') {
    return c.json({ success: false, message: 'Stripe secret key is not configured' }, 200);
  }

  try {
    const secretKey = decrypt(encryptedKey);
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(secretKey);
    const account = await stripe.accounts.retrieve();
    return c.json({
      success: true,
      message: `Connected to Stripe successfully`,
      accountName: account.settings?.dashboard?.display_name || account.business_profile?.name || account.id,
    });
  } catch (err) {
    logger.warn({ err }, 'Stripe connection test failed');
    logToErrorTable({ level: 'warn', message: `Stripe connection test failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'settings', operation: 'stripe-test' } });
    return c.json({ success: false, message: `Stripe connection failed: ${(err as Error).message}` }, 200);
  }
}) as any);

// PATCH /email
settings.openapi(updateEmailRoute, (async (c: any) => {
  const user = c.get('user');
  const accountId = c.get('accountId');

  const data = c.req.valid('json');

  if (user.isSuper) {
    // Platform-level email config (super admin always configures platform email, even with account selected)
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

    await invalidateCache('GET:/settings/*');
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
}) as any);

// POST /email/test — send a test email
settings.openapi(testEmailRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can send test emails' }, 403);
  }

  const { to } = c.req.valid('json');

  try {
    // Reset provider to pick up any recently saved config
    emailService.resetProvider();
    const result = await emailService.sendEmail(
      to,
      'Fleet Test Email',
      '<h1>Test Email</h1><p>This is a test email from your Fleet platform. If you received this, your email configuration is working correctly.</p>',
    );
    return c.json({ success: true, message: `Test email sent (ID: ${result.messageId})` });
  } catch (err) {
    logger.warn({ err, to }, 'Test email failed');
    logToErrorTable({ level: 'warn', message: `Test email failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'settings', operation: 'email-test' } });
    return c.json({ success: false, message: `Failed to send test email: ${(err as Error).message}` }, 200);
  }
}) as any);

// GET /registrar
settings.openapi(getRegistrarRoute, (async (c: any) => {
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
    apiKeySet: !!registrar.apiKey,
    apiKeyHint: maskSecret(registrar.apiKey),
    apiSecretHint: maskSecret(registrar.apiSecret),
  });
}) as any);

// PATCH /registrar
settings.openapi(updateRegistrarRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure registrar' }, 403);
  }

  const { provider, apiKey, apiSecret, resellerId, sandbox } = c.req.valid('json');
  const { domainRegistrars, eq: eqOp, insertReturning, updateReturning } = await import('@fleet/db');

  const existing = await db.query.domainRegistrars.findFirst({
    where: eqOp(domainRegistrars.enabled, true),
  });

  const config: Record<string, string> = {};
  if (resellerId) config['resellerId'] = resellerId;
  if (sandbox !== undefined) config['sandbox'] = String(sandbox);

  if (existing) {
    const updates: Record<string, any> = { provider, config };
    if (apiKey) updates.apiKey = encrypt(apiKey);
    if (apiSecret) updates.apiSecret = encrypt(apiSecret);
    const [updated] = await updateReturning(domainRegistrars, updates, eqOp(domainRegistrars.id, existing.id));
    // Reset provider cache
    const { registrarService } = await import('../services/registrar.service.js');
    registrarService.resetProvider();
    return c.json({ message: 'Registrar updated', id: updated?.id });
  }

  if (!apiKey) {
    return c.json({ error: 'API key is required for initial configuration' }, 400);
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
}) as any);

// POST /registrar/test
settings.openapi(testRegistrarRoute, (async (c: any) => {
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
    logger.error({ err }, 'Registrar connection test failed');
    logToErrorTable({ level: 'error', message: `Registrar connection test failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'settings', operation: 'registrar-test' } });
    return c.json({ success: false, error: 'Registrar connection test failed' }, 500);
  }
}) as any);

// GET /github
settings.openapi(getGithubRoute, (async (c: any) => {
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
    clientSecretHint: maskSecret(clientSecret) ?? (process.env['GITHUB_CLIENT_SECRET'] ? 'env••••••••' : null),
    webhookSecretSet: !!(webhookSecret || process.env['GITHUB_WEBHOOK_SECRET']),
    webhookSecretHint: maskSecret(webhookSecret) ?? (process.env['GITHUB_WEBHOOK_SECRET'] ? 'env••••••••' : null),
  });
}) as any);

// PATCH /github
settings.openapi(updateGithubRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure GitHub' }, 403);
  }

  const data = c.req.valid('json');

  if (data.clientId) {
    await upsertSetting('github:clientId', data.clientId);
  }
  if (data.clientSecret) {
    await upsertSetting('github:clientSecret', encrypt(data.clientSecret));
  }
  if (data.webhookSecret) {
    await upsertSetting('github:webhookSecret', encrypt(data.webhookSecret));
  }

  // Invalidate cached config so the new values take effect immediately
  const { invalidateGitHubConfigCache } = await import('../services/github.service.js');
  invalidateGitHubConfigCache();

  await invalidateCache('GET:/settings/*');
  logger.info({ changedBy: user.userId }, 'GitHub configuration updated');
  return c.json({ message: 'GitHub configuration updated' });
}) as any);

// GET /google
settings.openapi(getGoogleRoute, (async (c: any) => {
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
    clientSecretHint: maskSecret(clientSecret) ?? (process.env['GOOGLE_CLIENT_SECRET'] ? 'env••••••••' : null),
  });
}) as any);

// PATCH /google
settings.openapi(updateGoogleRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure Google' }, 403);
  }

  const data = c.req.valid('json');

  if (data.clientId) {
    await upsertSetting('google:clientId', data.clientId);
  }
  if (data.clientSecret) {
    await upsertSetting('google:clientSecret', encrypt(data.clientSecret));
  }

  // Invalidate cached config so the new values take effect immediately
  const { invalidateGoogleConfigCache } = await import('../services/google.service.js');
  invalidateGoogleConfigCache();

  await invalidateCache('GET:/settings/*');
  logger.info({ changedBy: user.userId }, 'Google configuration updated');
  return c.json({ message: 'Google configuration updated' });
}) as any);

// POST /branding
settings.openapi(uploadBrandingRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure branding' }, 403);
  }

  const body = await c.req.parseBody({ all: true });

  const logo = body['logo'] as File | undefined;
  const favicon = body['favicon'] as File | undefined;
  const title = body['title'] as string | undefined;

  if (!logo && !favicon && !title) {
    return c.json({ error: 'No branding fields provided' }, 400);
  }

  const saved: string[] = [];

  // Process logo
  if (logo && logo instanceof File) {
    const ext = logo.name.split('.').pop()?.toLowerCase();
    if (!ext || !['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext)) {
      return c.json({ error: 'Invalid logo file type. Allowed: png, jpg, jpeg, svg, webp' }, 400);
    }
    if (logo.size > 2 * 1024 * 1024) {
      return c.json({ error: 'Logo file too large. Max 2MB' }, 400);
    }

    await mkdir(BRANDING_DIR, { recursive: true });

    // Remove previous logo if extension differs
    const prevFilename = await getSetting('branding:logoFilename') as string | null;
    if (prevFilename) {
      const prevPath = join(BRANDING_DIR, prevFilename);
      try { await unlink(prevPath); } catch { /* file may not exist */ }
    }

    const filename = `logo.${ext}`;
    const buffer = Buffer.from(await logo.arrayBuffer());
    await writeFile(join(BRANDING_DIR, filename), buffer);
    await upsertSetting('branding:logoFilename', filename);
    saved.push('logo');
  }

  // Process favicon
  if (favicon && favicon instanceof File) {
    const ext = favicon.name.split('.').pop()?.toLowerCase();
    if (!ext || !['ico', 'png', 'svg'].includes(ext)) {
      return c.json({ error: 'Invalid favicon file type. Allowed: ico, png, svg' }, 400);
    }
    if (favicon.size > 500 * 1024) {
      return c.json({ error: 'Favicon file too large. Max 500KB' }, 400);
    }

    await mkdir(BRANDING_DIR, { recursive: true });

    // Remove previous favicon if extension differs
    const prevFilename = await getSetting('branding:faviconFilename') as string | null;
    if (prevFilename) {
      const prevPath = join(BRANDING_DIR, prevFilename);
      try { await unlink(prevPath); } catch { /* file may not exist */ }
    }

    const filename = `favicon.${ext}`;
    const buffer = Buffer.from(await favicon.arrayBuffer());
    await writeFile(join(BRANDING_DIR, filename), buffer);
    await upsertSetting('branding:faviconFilename', filename);
    saved.push('favicon');
  }

  // Process title
  if (title !== undefined) {
    await upsertSetting('branding:title', title);
    saved.push('title');
  }

  // Process githubUrl
  const githubUrl = body['githubUrl'] as string | undefined;
  if (githubUrl !== undefined) {
    await upsertSetting('branding:githubUrl', githubUrl || null);
    saved.push('githubUrl');
  }

  await invalidateCache('GET:/settings/*');
  logger.info({ saved, changedBy: user.userId }, 'Branding updated');
  return c.json({ message: 'Branding updated', saved });
}) as any);

// GET /branding
settings.openapi(getBrandingRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can view branding config' }, 403);
  }

  const logoFilename = await getSetting('branding:logoFilename') as string | null;
  const faviconFilename = await getSetting('branding:faviconFilename') as string | null;
  const title = await getSetting('branding:title') as string | null;
  const githubUrl = await getSetting('branding:githubUrl') as string | null;

  return c.json({
    title: title ?? null,
    logoUrl: logoFilename ? '/api/v1/branding/logo' : null,
    faviconUrl: faviconFilename ? '/api/v1/branding/favicon' : null,
    logoSet: !!logoFilename,
    faviconSet: !!faviconFilename,
    githubUrl: githubUrl ?? null,
  });
}) as any);

// DELETE /branding/:type
settings.openapi(deleteBrandingRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure branding' }, 403);
  }

  const { type } = c.req.valid('param');
  if (type !== 'logo' && type !== 'favicon') {
    return c.json({ error: 'Invalid type. Must be "logo" or "favicon"' }, 400);
  }

  const settingKey = type === 'logo' ? 'branding:logoFilename' : 'branding:faviconFilename';
  const filename = await getSetting(settingKey) as string | null;

  if (filename) {
    const filePath = join(BRANDING_DIR, filename);
    try { await unlink(filePath); } catch { /* file may not exist */ }
    await upsertSetting(settingKey, null);
  }

  await invalidateCache('GET:/settings/*');
  logger.info({ type, changedBy: user.userId }, 'Branding asset removed');
  return c.json({ message: `Branding ${type} removed` });
}) as any);

// GET /translation
settings.openapi(getTranslationRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can view translation config' }, 403);
  }

  const provider = await getSetting('translation:provider') as string | null;
  const deeplApiKey = await getSetting('translation:deepl_api_key');
  const claudeApiKey = await getSetting('translation:claude_api_key');

  return c.json({
    provider: provider ?? 'deepl',
    deeplConfigured: !!deeplApiKey,
    deeplApiKeyHint: maskSecret(deeplApiKey),
    claudeConfigured: !!claudeApiKey,
    claudeApiKeyHint: maskSecret(claudeApiKey),
  });
}) as any);

// PATCH /translation
settings.openapi(updateTranslationRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can configure translation' }, 403);
  }

  const data = c.req.valid('json');

  if (data.provider) {
    await upsertSetting('translation:provider', data.provider);
  }
  if (data.deeplApiKey) {
    await upsertSetting('translation:deepl_api_key', encrypt(data.deeplApiKey));
  }
  if (data.claudeApiKey) {
    await upsertSetting('translation:claude_api_key', encrypt(data.claudeApiKey));
  }

  await invalidateCache('GET:/settings/*');
  logger.info({ changedBy: user.userId }, 'Translation configuration updated');
  return c.json({ message: 'Translation configuration updated' });
}) as any);

// POST /translation/test — test the active translation provider
settings.openapi(testTranslationRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can test translation' }, 403);
  }

  const provider = (await getSetting('translation:provider') as string | null) ?? 'deepl';

  if (provider === 'claude') {
    const encryptedKey = await getSetting('translation:claude_api_key');
    if (!encryptedKey || typeof encryptedKey !== 'string') {
      return c.json({ success: false, message: 'Claude API key is not configured' }, 200);
    }

    try {
      const apiKey = decrypt(encryptedKey);
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with just the word "ok".' }],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return c.json({ success: false, message: `Claude API error: ${res.status} ${text}` }, 200);
      }

      return c.json({ success: true, message: 'Connected to Claude API successfully' });
    } catch (err) {
      logger.warn({ err }, 'Claude connection test failed');
      logToErrorTable({ level: 'warn', message: `Claude connection test failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'settings', operation: 'translation-test' } });
      return c.json({ success: false, message: `Claude connection failed: ${(err as Error).message}` }, 200);
    }
  }

  // DeepL test
  const encryptedKey = await getSetting('translation:deepl_api_key');
  if (!encryptedKey || typeof encryptedKey !== 'string') {
    return c.json({ success: false, message: 'DeepL API key is not configured' }, 200);
  }

  try {
    const apiKey = decrypt(encryptedKey);
    const baseUrl = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const res = await fetch(`${baseUrl}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return c.json({ success: false, message: `DeepL API error: ${res.status} ${text}` }, 200);
    }

    const usage = await res.json() as { character_count: number; character_limit: number };
    return c.json({
      success: true,
      message: 'Connected to DeepL successfully',
      characterCount: usage.character_count,
      characterLimit: usage.character_limit,
    });
  } catch (err) {
    logger.warn({ err }, 'DeepL connection test failed');
    logToErrorTable({ level: 'warn', message: `DeepL connection test failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'settings', operation: 'translation-test' } });
    return c.json({ success: false, message: `DeepL connection failed: ${(err as Error).message}` }, 200);
  }
}) as any);

// ── Self-Healing settings ──

const selfHealingSettingsSchema = z.object({
  anthropicApiKey: z.string().min(1).optional(),
  githubPat: z.string().min(1).optional(),
  repoOwner: z.string().min(1).optional(),
  repoName: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).optional(),
});

const getSelfHealingRoute = createRoute({
  method: 'get',
  path: '/self-healing',
  tags: ['Settings'],
  summary: 'Get self-healing configuration (super admin only)',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'Self-healing configuration'),
    ...standardErrors,
  },
});

const updateSelfHealingRoute = createRoute({
  method: 'patch',
  path: '/self-healing',
  tags: ['Settings'],
  summary: 'Configure self-healing (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(selfHealingSettingsSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Self-healing configuration updated'),
    ...standardErrors,
  },
});

const testSelfHealingRoute = createRoute({
  method: 'post',
  path: '/self-healing/test',
  tags: ['Settings'],
  summary: 'Test self-healing API keys (super admin only)',
  security: bearerSecurity,
  middleware: [settingsRateLimit, requireAdmin] as const,
  responses: {
    200: jsonContent(z.any(), 'Test result'),
    ...standardErrors,
  },
});

// GET /self-healing
settings.openapi(getSelfHealingRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Only super admins can view self-healing config' }, 403);

  const anthropicApiKey = await getSetting('selfhealing:anthropic_api_key');
  const githubPat = await getSetting('selfhealing:github_pat');
  const repoOwner = await getSetting('selfhealing:repo_owner');
  const repoName = await getSetting('selfhealing:repo_name');
  const defaultBranch = await getSetting('selfhealing:default_branch');
  const defaultOptions = await getSetting('selfhealing:default_options');

  return c.json({
    anthropicConfigured: !!anthropicApiKey,
    anthropicApiKeyHint: anthropicApiKey ? maskSecret(anthropicApiKey) : null,
    githubPatConfigured: !!githubPat,
    githubPatHint: githubPat ? maskSecret(githubPat) : null,
    repoOwner: repoOwner ?? '',
    repoName: repoName ?? '',
    defaultBranch: defaultBranch ?? 'main',
    defaultOptions: defaultOptions ?? { autoMerge: false, autoRelease: false, autoUpdate: false, releaseType: 'release' },
  });
}) as any);

// PATCH /self-healing
settings.openapi(updateSelfHealingRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Only super admins can configure self-healing' }, 403);

  const data = c.req.valid('json');

  if (data.anthropicApiKey) {
    await upsertSetting('selfhealing:anthropic_api_key', encrypt(data.anthropicApiKey));
  }
  if (data.githubPat) {
    await upsertSetting('selfhealing:github_pat', encrypt(data.githubPat));
  }
  if (data.repoOwner !== undefined) {
    await upsertSetting('selfhealing:repo_owner', data.repoOwner);
  }
  if (data.repoName !== undefined) {
    await upsertSetting('selfhealing:repo_name', data.repoName);
  }
  if (data.defaultBranch !== undefined) {
    await upsertSetting('selfhealing:default_branch', data.defaultBranch);
  }

  // Invalidate service config cache
  const { invalidateConfigCache } = await import('../services/self-healing.service.js');
  invalidateConfigCache();

  return c.json({ message: 'Self-healing configuration updated' });
}) as any);

// POST /self-healing/test
settings.openapi(testSelfHealingRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Only super admins can test self-healing' }, 403);

  const results: { anthropic: { success: boolean; message: string } | null; github: { success: boolean; message: string } | null } = {
    anthropic: null,
    github: null,
  };

  // Test Anthropic API key
  const encryptedAnthropicKey = await getSetting('selfhealing:anthropic_api_key');
  if (encryptedAnthropicKey) {
    try {
      const apiKey = decrypt(encryptedAnthropicKey as string);
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        results.anthropic = { success: true, message: 'Anthropic API key is valid' };
      } else {
        const body = await res.text();
        results.anthropic = { success: false, message: `Anthropic API error: ${res.status} ${body.slice(0, 200)}` };
      }
    } catch (err: any) {
      results.anthropic = { success: false, message: `Anthropic test failed: ${err.message}` };
    }
  }

  // Test GitHub PAT
  const encryptedGithubPat = await getSetting('selfhealing:github_pat');
  if (encryptedGithubPat) {
    try {
      const pat = decrypt(encryptedGithubPat as string);
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${pat}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Fleet-SelfHealing',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json() as { login: string };
        results.github = { success: true, message: `GitHub PAT valid (user: ${data.login})` };
      } else {
        results.github = { success: false, message: `GitHub API error: ${res.status}` };
      }
    } catch (err: any) {
      results.github = { success: false, message: `GitHub test failed: ${err.message}` };
    }
  }

  return c.json(results);
}) as any);

export default settings;
