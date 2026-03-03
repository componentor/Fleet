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
import { orchestrator, getDefaultOrchestratorType, setDefaultOrchestratorType, getAvailableOrchestrators, isKubernetesAvailable, isSwarmAvailable, getOrchestrator, reloadOrchestrators } from '../services/orchestrator.js';
import type { OrchestratorType } from '../services/orchestrator.js';
import { migrateService, migrateAccountServices } from '../services/orchestrator-migration.service.js';

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
    const services = await orchestrator.listServices({ name: [cfg.name] });
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

    await orchestrator.updateService((svc as any).ID, { labels });
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

// ── Orchestrator configuration ──

// GET /settings/orchestrator — current orchestrator config
settings.get('/orchestrator', authMiddleware, requireAdmin as any, (async (c: any) => {
  const current = getDefaultOrchestratorType();
  const available = getAvailableOrchestrators();

  // Get per-service breakdown
  const allServices = await db.query.services.findMany({
    columns: { id: true, orchestrator: true, status: true, deletedAt: true },
  });
  const active = allServices.filter((s) => !s.deletedAt && s.status !== 'deleted');
  const swarmCount = active.filter((s) => (s.orchestrator ?? current) === 'swarm').length;
  const k8sCount = active.filter((s) => (s.orchestrator ?? current) === 'kubernetes').length;

  return c.json({
    default: current,
    available,
    kubernetes: { available: isKubernetesAvailable() },
    swarm: { available: isSwarmAvailable() },
    services: { total: active.length, swarm: swarmCount, kubernetes: k8sCount },
  });
}) as any);

// PATCH /settings/orchestrator — update default orchestrator
settings.patch('/orchestrator', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const body = await c.req.json();
  const type = body.default as OrchestratorType;
  if (type !== 'swarm' && type !== 'kubernetes') {
    return c.json({ error: 'Invalid orchestrator type. Must be "swarm" or "kubernetes"' }, 400);
  }

  if (type === 'kubernetes' && !isKubernetesAvailable()) {
    return c.json({ error: 'Kubernetes is not available. Ensure kubeconfig is configured.' }, 400);
  }

  // Persist to platform settings
  await db.insert(platformSettings).values({
    key: 'orchestrator:default',
    value: JSON.stringify(type),
  }).onConflictDoUpdate({
    target: platformSettings.key,
    set: { value: JSON.stringify(type), updatedAt: new Date() },
  });

  setDefaultOrchestratorType(type);

  return c.json({ default: type, message: `Default orchestrator set to ${type}` });
}) as any);

// POST /settings/orchestrator/migrate — migrate a single service
settings.post('/orchestrator/migrate', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const body = await c.req.json();
  const { serviceId, target } = body as { serviceId: string; target: OrchestratorType };

  if (!serviceId || (target !== 'swarm' && target !== 'kubernetes')) {
    return c.json({ error: 'serviceId and target ("swarm" or "kubernetes") are required' }, 400);
  }

  if (target === 'kubernetes' && !isKubernetesAvailable()) {
    return c.json({ error: 'Kubernetes is not available' }, 400);
  }

  const result = await migrateService(serviceId, target);
  return c.json(result, result.success ? 200 : 500);
}) as any);

// POST /settings/orchestrator/migrate-account — migrate all services for an account
settings.post('/orchestrator/migrate-account', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const body = await c.req.json();
  const { accountId, target } = body as { accountId: string; target: OrchestratorType };

  if (!accountId || (target !== 'swarm' && target !== 'kubernetes')) {
    return c.json({ error: 'accountId and target ("swarm" or "kubernetes") are required' }, 400);
  }

  if (target === 'kubernetes' && !isKubernetesAvailable()) {
    return c.json({ error: 'Kubernetes is not available' }, 400);
  }

  const results = await migrateAccountServices(accountId, target);
  const successCount = results.filter((r) => r.success).length;
  return c.json({
    total: results.length,
    succeeded: successCount,
    failed: results.length - successCount,
    results,
  });
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// Orchestrator Installation
// ────────────────────────────────────────────────────────────────────────────

// GET /settings/orchestrator/k3s-status — check k3s installation state
settings.get('/orchestrator/k3s-status', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const logs: string[] = [];
  let installed = false;
  let running = false;
  let nodeCount = 0;
  let readyNodes = 0;
  let joinToken: string | null = null;
  let serverUrl: string | null = null;

  try {
    // Check if k3s binary is present and service is running
    const checkResult = await orchestrator.runOnLocalHost(
      'which k3s >/dev/null 2>&1 && echo "INSTALLED" || echo "NOT_INSTALLED"; ' +
      'systemctl is-active k3s 2>/dev/null || echo "NOT_RUNNING"; ' +
      'cat /var/lib/rancher/k3s/server/node-token 2>/dev/null || echo "NO_TOKEN"',
      { timeoutMs: 15000 },
    );

    const output = checkResult.stdout ?? '';
    installed = output.includes('INSTALLED');
    running = !output.includes('NOT_RUNNING');

    // Read join token — look for the token line (starts with K10 or similar)
    const tokenLine = output.split('\n').find((l: string) => l.startsWith('K10') || l.startsWith('K3s'));
    if (tokenLine && tokenLine !== 'NO_TOKEN') {
      joinToken = tokenLine.trim();
    }

    // Detect server URL
    const ipResult = await orchestrator.runOnLocalHost(
      "ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}'",
      { timeoutMs: 10000 },
    );
    const ip = (ipResult.stdout ?? '').trim();
    if (ip) serverUrl = `https://${ip}:6443`;
  } catch {
    logs.push('Could not check k3s status on local host');
  }

  // Fallback: check env vars (set by install.sh via env_file)
  if (!joinToken && process.env['K3S_TOKEN']) {
    joinToken = process.env['K3S_TOKEN'];
    logs.push('Token found from environment variable');
  }
  if (!serverUrl && process.env['K3S_URL']) {
    serverUrl = process.env['K3S_URL'];
    logs.push('Server URL found from environment variable');
  }

  // Persist discovered token/URL to DB so install-k3s-agents can find them
  if (joinToken) {
    await db.insert(platformSettings).values({ key: 'k3s:joinToken', value: encrypt(joinToken) })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: encrypt(joinToken), updatedAt: new Date() } })
      .catch(() => {});
  }
  if (serverUrl) {
    await db.insert(platformSettings).values({ key: 'k3s:serverUrl', value: serverUrl })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: serverUrl, updatedAt: new Date() } })
      .catch(() => {});
  }

  // If k3s is available, count K8s nodes
  if (isKubernetesAvailable()) {
    try {
      const k8s = getOrchestrator('kubernetes');
      const nodes = await k8s.listNodes();
      const nodeList = Array.isArray(nodes) ? nodes : (nodes as any)?.items ?? [];
      nodeCount = nodeList.length;
      readyNodes = nodeList.filter((n: any) => {
        const conditions = n.status?.conditions ?? n.Status?.conditions ?? [];
        return conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
      }).length;
    } catch {
      logs.push('K8s API reachable but could not list nodes');
    }
  }

  return c.json({ installed, running, nodeCount, readyNodes, joinToken, serverUrl, logs });
}) as any);

// POST /settings/orchestrator/install-k3s — install k3s server on the local node
settings.post('/orchestrator/install-k3s', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const logs: string[] = [];

  try {
    // Step 1: Install k3s server
    logs.push('Installing k3s server...');
    const installResult = await orchestrator.runOnLocalHost(
      'curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server ' +
        '--flannel-backend=none ' +
        '--disable-network-policy ' +
        '--disable=traefik ' +
        '--disable=servicelb ' +
        '--write-kubeconfig-mode=644" sh -',
      { timeoutMs: 300000 },
    );
    if (installResult.exitCode !== 0) {
      logs.push(`k3s install failed (exit ${installResult.exitCode}): ${installResult.stdout}`);
      return c.json({ success: false, logs }, 500);
    }
    logs.push('k3s server installed');

    // Step 2: Wait for kubeconfig
    logs.push('Waiting for kubeconfig...');
    const waitResult = await orchestrator.runOnLocalHost(
      'for i in $(seq 1 30); do [ -f /etc/rancher/k3s/k3s.yaml ] && echo "READY" && break; sleep 2; done',
      { timeoutMs: 90000 },
    );
    if (!(waitResult.stdout ?? '').includes('READY')) {
      logs.push('Timed out waiting for kubeconfig');
      return c.json({ success: false, logs }, 500);
    }
    logs.push('kubeconfig ready');

    // Step 3: Install Cilium CNI
    logs.push('Installing Cilium CNI...');
    const ciliumResult = await orchestrator.runOnLocalHost(
      'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; ' +
      'if ! command -v cilium >/dev/null 2>&1; then ' +
        'CILIUM_CLI_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt); ' +
        'curl -L --fail --remote-name-all ' +
          '"https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-amd64.tar.gz" 2>/dev/null; ' +
        'tar xzf cilium-linux-amd64.tar.gz -C /usr/local/bin 2>/dev/null; ' +
        'rm -f cilium-linux-amd64.tar.gz; ' +
      'fi; ' +
      'cilium install --set kubeProxyReplacement=true 2>&1; ' +
      'cilium status --wait --wait-duration 120s 2>&1 || true',
      { timeoutMs: 300000 },
    );
    logs.push(`Cilium: ${(ciliumResult.stdout ?? '').slice(-200)}`);

    // Step 4: Read join token
    const tokenResult = await orchestrator.runOnLocalHost(
      'cat /var/lib/rancher/k3s/server/node-token 2>/dev/null',
      { timeoutMs: 10000 },
    );
    const joinToken = (tokenResult.stdout ?? '').trim();

    // Detect server IP for join URL
    const ipResult = await orchestrator.runOnLocalHost(
      "ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}'",
      { timeoutMs: 10000 },
    );
    const serverIp = (ipResult.stdout ?? '').trim();
    const serverUrl = serverIp ? `https://${serverIp}:6443` : '';

    // Step 5: Store join token + URL in platformSettings
    if (joinToken) {
      await db.insert(platformSettings).values({ key: 'k3s:joinToken', value: encrypt(joinToken) })
        .onConflictDoUpdate({ target: platformSettings.key, set: { value: encrypt(joinToken), updatedAt: new Date() } });
    }
    if (serverUrl) {
      await db.insert(platformSettings).values({ key: 'k3s:serverUrl', value: serverUrl })
        .onConflictDoUpdate({ target: platformSettings.key, set: { value: serverUrl, updatedAt: new Date() } });
    }

    // Step 6: Reload orchestrator so K8s becomes available
    await reloadOrchestrators();
    logs.push('Orchestrator reloaded — Kubernetes is now available');

    return c.json({ success: true, logs, joinToken: joinToken || null, serverUrl: serverUrl || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`Error: ${message}`);
    logToErrorTable({ level: 'error', message: `k3s install failed: ${message}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'orchestrator', operation: 'install-k3s' } });
    return c.json({ success: false, logs, error: message }, 500);
  }
}) as any);

// POST /settings/orchestrator/install-k3s-agents — install k3s agent on all worker nodes
settings.post('/orchestrator/install-k3s-agents', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  // Read join token and server URL — try DB first, then env vars, then host file
  let joinToken = '';
  let serverUrl = '';

  const tokenRow = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, 'k3s:joinToken') });
  if (tokenRow?.value) {
    try { joinToken = decrypt(tokenRow.value as string); } catch { joinToken = tokenRow.value as string; }
  }
  const urlRow = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, 'k3s:serverUrl') });
  if (urlRow?.value) serverUrl = urlRow.value as string;

  // Fallback: check env vars (set by install.sh via env_file)
  if (!joinToken && process.env['K3S_TOKEN']) joinToken = process.env['K3S_TOKEN'];
  if (!serverUrl && process.env['K3S_URL']) serverUrl = process.env['K3S_URL'];

  // Fallback: try reading from host file via each available orchestrator backend
  if (!joinToken || !serverUrl) {
    const backends: OrchestratorType[] = ['swarm', 'kubernetes'];
    for (const backend of backends) {
      if (joinToken && serverUrl) break;
      try {
        const orch = getOrchestrator(backend);
        if (!orch) continue;

        if (!joinToken) {
          const tokenResult = await orch.runOnLocalHost('cat /var/lib/rancher/k3s/server/node-token 2>/dev/null', { timeoutMs: 10000 });
          const t = (tokenResult.stdout ?? '').trim();
          if (t) joinToken = t;
        }

        if (!serverUrl) {
          const ipResult = await orch.runOnLocalHost("ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}'", { timeoutMs: 10000 });
          const ip = (ipResult.stdout ?? '').trim();
          if (ip) serverUrl = `https://${ip}:6443`;
        }
      } catch {
        // This backend can't run host commands — try the next one
      }
    }
  }

  // Persist discovered token/URL to DB for future requests
  if (joinToken && !tokenRow?.value) {
    await db.insert(platformSettings).values({ key: 'k3s:joinToken', value: encrypt(joinToken) })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: encrypt(joinToken), updatedAt: new Date() } })
      .catch(() => {});
  }
  if (serverUrl && !urlRow?.value) {
    await db.insert(platformSettings).values({ key: 'k3s:serverUrl', value: serverUrl })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: serverUrl, updatedAt: new Date() } })
      .catch(() => {});
  }

  if (!joinToken || !serverUrl) {
    return c.json({ error: 'k3s join token or server URL not available. Install k3s server first.' }, 400);
  }

  try {
    const escapedToken = joinToken.replace(/'/g, "'\\''");
    const escapedUrl = serverUrl.replace(/'/g, "'\\''");

    const result = await orchestrator.runOnAllNodes(
      `if command -v k3s >/dev/null 2>&1; then echo "k3s already installed"; ` +
      `else curl -sfL https://get.k3s.io | K3S_URL='${escapedUrl}' K3S_TOKEN='${escapedToken}' sh - 2>&1; fi`,
      { timeoutMs: 300000 },
    );

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToErrorTable({ level: 'error', message: `k3s agent install failed: ${message}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'orchestrator', operation: 'install-k3s-agents' } });
    return c.json({ success: false, error: message }, 500);
  }
}) as any);

// GET /settings/orchestrator/docker-status — check Docker + Swarm state
settings.get('/orchestrator/docker-status', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  let installed = false;
  let swarmActive = false;
  let role: string | null = null;
  let nodeCount = 0;
  let joinToken: string | null = null;

  try {
    const result = await orchestrator.runOnLocalHost(
      'command -v docker >/dev/null 2>&1 && echo "DOCKER_INSTALLED" || echo "NO_DOCKER"; ' +
      'docker info --format "{{.Swarm.LocalNodeState}}" 2>/dev/null || echo "NO_SWARM"; ' +
      'docker info --format "{{.Swarm.ControlAvailable}}" 2>/dev/null || echo "UNKNOWN"',
      { timeoutMs: 15000 },
    );
    const output = result.stdout ?? '';
    installed = output.includes('DOCKER_INSTALLED');
    swarmActive = output.includes('active');
    role = output.includes('true') ? 'manager' : output.includes('false') ? 'worker' : null;
  } catch {
    // Can't reach host
  }

  if (isSwarmAvailable() && swarmActive) {
    try {
      const swarm = getOrchestrator('swarm');
      const nodes = await swarm.listNodes();
      nodeCount = Array.isArray(nodes) ? nodes.length : 0;
      const tokens = await swarm.getJoinToken();
      joinToken = tokens.worker;
    } catch { /* non-critical */ }
  }

  return c.json({ installed, swarmActive, role, nodeCount, joinToken });
}) as any);

// POST /settings/orchestrator/install-docker — install Docker and init Swarm on the local node
settings.post('/orchestrator/install-docker', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const logs: string[] = [];

  try {
    // Step 1: Install Docker
    logs.push('Installing Docker...');
    const installResult = await orchestrator.runOnLocalHost(
      'if command -v docker >/dev/null 2>&1; then echo "Docker already installed"; ' +
      'else curl -fsSL https://get.docker.com | sh 2>&1; fi; ' +
      'systemctl enable docker 2>/dev/null; systemctl start docker 2>/dev/null',
      { timeoutMs: 300000 },
    );
    logs.push(installResult.stdout?.slice(-300) ?? '');
    if (installResult.exitCode !== 0) {
      logs.push(`Docker install failed (exit ${installResult.exitCode})`);
      return c.json({ success: false, logs }, 500);
    }
    logs.push('Docker installed');

    // Step 2: Initialize Swarm
    logs.push('Initializing Docker Swarm...');
    const swarmResult = await orchestrator.runOnLocalHost(
      'if docker info 2>/dev/null | grep -q "Swarm: active"; then echo "Swarm already active"; ' +
      "else ADDR=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}'); " +
      'docker swarm init --advertise-addr "$ADDR" 2>&1; fi',
      { timeoutMs: 60000 },
    );
    logs.push(swarmResult.stdout?.slice(-300) ?? '');
    logs.push('Swarm initialized');

    // Step 3: Create overlay networks
    logs.push('Creating overlay networks...');
    await orchestrator.runOnLocalHost(
      'docker network create --driver overlay --attachable fleet_public 2>/dev/null || true; ' +
      'docker network create --driver overlay --attachable fleet_internal 2>/dev/null || true',
      { timeoutMs: 30000 },
    );
    logs.push('Networks created');

    // Step 4: Reload orchestrator
    await reloadOrchestrators();
    logs.push('Orchestrator reloaded — Docker Swarm is now available');

    return c.json({ success: true, logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`Error: ${message}`);
    logToErrorTable({ level: 'error', message: `Docker install failed: ${message}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'orchestrator', operation: 'install-docker' } });
    return c.json({ success: false, logs, error: message }, 500);
  }
}) as any);

// POST /settings/orchestrator/install-docker-agents — install Docker on all worker nodes and join Swarm
settings.post('/orchestrator/install-docker-agents', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  // Get Swarm join token
  let joinToken = '';
  let managerAddr = '';

  if (isSwarmAvailable()) {
    try {
      const swarm = getOrchestrator('swarm');
      const tokens = await swarm.getJoinToken();
      joinToken = tokens.worker;
      const info = await swarm.getClusterInfo();
      // Extract manager advertise addr
      const nodes = await swarm.listNodes();
      const manager = (Array.isArray(nodes) ? nodes : []).find((n: any) =>
        n.Spec?.Role === 'manager' || n.ManagerStatus?.Leader,
      );
      managerAddr = manager?.ManagerStatus?.Addr ?? manager?.Status?.Addr ?? '';
    } catch { /* fallback below */ }
  }

  if (!joinToken || !managerAddr) {
    try {
      const result = await orchestrator.runOnLocalHost(
        'docker swarm join-token worker -q 2>/dev/null; echo "---"; ' +
        "ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}'",
        { timeoutMs: 15000 },
      );
      const parts = (result.stdout ?? '').split('---');
      joinToken = (parts[0] ?? '').trim();
      const ip = (parts[1] ?? '').trim();
      managerAddr = ip ? `${ip}:2377` : '';
    } catch {
      return c.json({ error: 'Could not retrieve Swarm join token. Ensure Docker Swarm is initialized.' }, 400);
    }
  }

  if (!joinToken || !managerAddr) {
    return c.json({ error: 'Swarm join token or manager address not available. Install Docker + Swarm first.' }, 400);
  }

  try {
    const escapedToken = joinToken.replace(/'/g, "'\\''");
    const escapedAddr = managerAddr.replace(/'/g, "'\\''");

    const result = await orchestrator.runOnAllNodes(
      'if command -v docker >/dev/null 2>&1; then echo "Docker already installed"; ' +
      'else curl -fsSL https://get.docker.com | sh 2>&1; ' +
      'systemctl enable docker 2>/dev/null; systemctl start docker 2>/dev/null; fi; ' +
      `if docker info 2>/dev/null | grep -q "Swarm: active"; then echo "Already in swarm"; ` +
      `else docker swarm join --token '${escapedToken}' '${escapedAddr}' 2>&1; fi`,
      { timeoutMs: 300000 },
    );

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToErrorTable({ level: 'error', message: `Docker agent install failed: ${message}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'orchestrator', operation: 'install-docker-agents' } });
    return c.json({ success: false, error: message }, 500);
  }
}) as any);

// GET /settings/orchestrator/monitoring-status — check K8s monitoring health
settings.get('/orchestrator/monitoring-status', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const orchType = getDefaultOrchestratorType();
  if (orchType !== 'kubernetes' || !isKubernetesAvailable()) {
    return c.json({
      orchestratorType: orchType,
      metricsServer: { installed: false, healthy: false },
      kubeletStats: { available: false },
    });
  }

  const k8s = getOrchestrator('kubernetes') as import('../services/kubernetes.service.js').KubernetesService;

  const [metricsServer, kubeletAvailable] = await Promise.all([
    k8s.checkMetricsServer(),
    k8s.checkKubeletStats(),
  ]);

  return c.json({
    orchestratorType: 'kubernetes',
    metricsServer,
    kubeletStats: { available: kubeletAvailable },
  });
}) as any);

// POST /settings/orchestrator/install-metrics-server — install K8s metrics-server
settings.post('/orchestrator/install-metrics-server', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  if (!isKubernetesAvailable()) {
    return c.json({ success: false, error: 'Kubernetes is not available' }, 400);
  }

  const logs: string[] = [];

  try {
    // Check if metrics-server is already running
    const k8s = getOrchestrator('kubernetes') as import('../services/kubernetes.service.js').KubernetesService;
    const current = await k8s.checkMetricsServer();
    if (current.installed && current.healthy) {
      return c.json({ success: true, logs: ['metrics-server is already installed and healthy'], alreadyInstalled: true });
    }

    // Try K3s built-in metrics-server first
    logs.push('Checking for K3s embedded metrics-server...');
    const k3sCheck = await orchestrator.runOnLocalHost(
      'command -v k3s >/dev/null 2>&1 && echo "K3S_FOUND" || echo "NO_K3S"',
      { timeoutMs: 10000 },
    );

    if ((k3sCheck.stdout ?? '').includes('K3S_FOUND')) {
      // K3s: metrics-server is bundled, just ensure it's not disabled
      logs.push('K3s detected — metrics-server is bundled by default');
      logs.push('Checking if metrics-server deployment exists...');
      const checkResult = await orchestrator.runOnLocalHost(
        'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; kubectl get deployment metrics-server -n kube-system -o jsonpath="{.status.readyReplicas}" 2>/dev/null || echo "NOT_FOUND"',
        { timeoutMs: 15000 },
      );
      const output = (checkResult.stdout ?? '').trim();
      if (output !== 'NOT_FOUND' && output !== '' && output !== '0') {
        logs.push(`metrics-server is running with ${output} ready replicas`);
        return c.json({ success: true, logs });
      }
      logs.push('metrics-server not running — applying manifest...');
    }

    // Install metrics-server from official manifest
    logs.push('Applying official metrics-server manifest...');
    const kubeconfig = (k3sCheck.stdout ?? '').includes('K3S_FOUND')
      ? 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; '
      : '';

    const installResult = await orchestrator.runOnLocalHost(
      `${kubeconfig}kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml 2>&1`,
      { timeoutMs: 60000 },
    );
    logs.push(installResult.stdout?.slice(-500) ?? '');

    if (installResult.exitCode !== 0) {
      logs.push(`metrics-server install failed (exit ${installResult.exitCode})`);
      return c.json({ success: false, logs }, 500);
    }

    // For non-public clusters, patch to allow insecure TLS (common in self-hosted)
    logs.push('Patching metrics-server for insecure kubelet TLS (self-hosted clusters)...');
    await orchestrator.runOnLocalHost(
      `${kubeconfig}kubectl patch deployment metrics-server -n kube-system --type='json' ` +
      `-p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]' 2>&1 || true`,
      { timeoutMs: 30000 },
    );

    // Wait for metrics-server to become ready (poll up to 90s)
    logs.push('Waiting for metrics-server to become ready...');
    const waitResult = await orchestrator.runOnLocalHost(
      `${kubeconfig}kubectl rollout status deployment/metrics-server -n kube-system --timeout=90s 2>&1`,
      { timeoutMs: 120000 },
    );
    logs.push(waitResult.stdout?.slice(-300) ?? '');

    // Verify metrics API responds
    logs.push('Verifying metrics API...');
    const verify = await k8s.checkMetricsServer();
    if (verify.healthy) {
      logs.push('metrics-server is healthy and responding');
    } else {
      logs.push('metrics-server deployed but API not yet responding — may need a moment to initialize');
    }

    return c.json({ success: true, logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`Error: ${message}`);
    logToErrorTable({
      level: 'error',
      message: `metrics-server install failed: ${message}`,
      stack: err instanceof Error ? err.stack : null,
      metadata: { context: 'orchestrator', operation: 'install-metrics-server' },
    });
    return c.json({ success: false, logs, error: message }, 500);
  }
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// Registry health check & repair
// ────────────────────────────────────────────────────────────────────────────

// GET /settings/registry/health — check internal registry health
settings.get('/registry/health', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const RAW_REG = process.env['REGISTRY_URL'] ?? '';
  const platformDom = await getPlatformDomain();
  const REGISTRY_URL = (RAW_REG && !RAW_REG.match(/:\d+$/) && RAW_REG !== 'localhost') ? RAW_REG : (platformDom || RAW_REG);
  const REGISTRY_USER = process.env['REGISTRY_USER'] ?? 'fleet';
  const REGISTRY_PASSWORD = process.env['REGISTRY_PASSWORD'] ?? '';

  const result: {
    registryUrl: string;
    reachable: boolean;
    authWorks: boolean;
    serviceRunning: boolean;
    error?: string;
  } = {
    registryUrl: REGISTRY_URL,
    reachable: false,
    authWorks: false,
    serviceRunning: false,
  };

  try {
    // Check if the registry Swarm/K8s service is running
    try {
      const services = await orchestrator.listServices({ name: ['fleet_registry', 'registry'] });
      result.serviceRunning = services.some((s: any) => {
        const replicas = (s as any).Spec?.Mode?.Replicated?.Replicas ?? (s as any).spec?.replicas ?? 0;
        return replicas > 0;
      });
    } catch {
      // If listServices fails, try checking via the orchestrator's own mechanism
      result.serviceRunning = false;
    }

    // Check /v2/ endpoint through Traefik (HTTPS)
    if (REGISTRY_URL) {
      try {
        const resp = await fetch(`https://${REGISTRY_URL}/v2/`, {
          signal: AbortSignal.timeout(10000),
          headers: REGISTRY_USER && REGISTRY_PASSWORD
            ? { Authorization: `Basic ${Buffer.from(`${REGISTRY_USER}:${REGISTRY_PASSWORD}`).toString('base64')}` }
            : {},
        });
        result.reachable = resp.status === 200 || resp.status === 401;
        result.authWorks = resp.status === 200;
      } catch (err) {
        result.error = `Registry unreachable at https://${REGISTRY_URL}/v2/: ${String(err)}`;
      }
    }

    return c.json(result);
  } catch (err) {
    logToErrorTable({ level: 'error', message: `Registry health check failed: ${String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'registry', operation: 'health' } });
    return c.json({ ...result, error: String(err) }, 500);
  }
}) as any);

// POST /settings/registry/repair — force-restart the registry service
settings.post('/registry/repair', authMiddleware, requireAdmin as any, (async (c: any) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const logs: string[] = [];
  try {
    // Force-update the registry service (recreates containers)
    logs.push('Force-restarting registry service...');
    const result = await orchestrator.runOnLocalHost(
      'docker service update --force fleet_registry 2>&1 || echo "SWARM_FAIL"',
      { timeoutMs: 60000 },
    );
    logs.push(result.stdout);

    if (result.stdout.includes('SWARM_FAIL')) {
      logs.push('Swarm force-update failed, trying full recreate...');
      // Remove and re-deploy just the registry service
      const removeResult = await orchestrator.runOnLocalHost(
        'docker service rm fleet_registry 2>&1; sleep 2; ' +
        'cd /opt/fleet && docker stack deploy -c docker-stack.yml --with-registry-auth fleet 2>&1',
        { timeoutMs: 120000 },
      );
      logs.push(removeResult.stdout);
    }

    // Wait for registry to be healthy
    logs.push('Waiting for registry to become healthy...');
    const RAW_REG2 = process.env['REGISTRY_URL'] ?? '';
    const platDom2 = await getPlatformDomain();
    const REGISTRY_URL = (RAW_REG2 && !RAW_REG2.match(/:\d+$/) && RAW_REG2 !== 'localhost') ? RAW_REG2 : (platDom2 || RAW_REG2);
    const REGISTRY_USER = process.env['REGISTRY_USER'] ?? 'fleet';
    const REGISTRY_PASSWORD = process.env['REGISTRY_PASSWORD'] ?? '';

    let healthy = false;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const resp = await fetch(`https://${REGISTRY_URL}/v2/`, {
          signal: AbortSignal.timeout(5000),
          headers: REGISTRY_USER && REGISTRY_PASSWORD
            ? { Authorization: `Basic ${Buffer.from(`${REGISTRY_USER}:${REGISTRY_PASSWORD}`).toString('base64')}` }
            : {},
        });
        if (resp.status === 200) {
          healthy = true;
          break;
        }
      } catch { /* retry */ }
    }

    if (healthy) {
      logs.push('Registry is healthy and responding.');
      return c.json({ success: true, logs });
    } else {
      logs.push('Registry did not become healthy within 60 seconds.');
      return c.json({ success: false, logs, error: 'Registry did not become healthy' }, 500);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToErrorTable({ level: 'error', message: `Registry repair failed: ${message}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'registry', operation: 'repair' } });
    return c.json({ success: false, logs, error: message }, 500);
  }
}) as any);

export default settings;
