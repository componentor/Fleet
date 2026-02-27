import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, platformSettings, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { loadAdminPermissions, requireSuperAdmin } from '../middleware/admin-permission.js';
import type { AdminPermissions } from '../middleware/admin-permission.js';
import { decrypt } from '../services/crypto.service.js';
import { logger } from '../services/logger.js';
import {
  jsonBody,
  jsonContent,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type Env = {
  Variables: { user: AuthUser; adminPermissions: AdminPermissions | null };
};

const adminI18nRoutes = new OpenAPIHono<Env>();

// All routes require auth + super admin
adminI18nRoutes.use('*', authMiddleware);
adminI18nRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper && !user.adminRoleId) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
});
adminI18nRoutes.use('*', loadAdminPermissions);
adminI18nRoutes.use('*', requireSuperAdmin());

// ── Helpers ──

const BUILT_IN_LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'nb', name: 'Norsk Bokmål' },
  { code: 'de', name: 'Deutsch' },
  { code: 'zh', name: '中文' },
];

const BUILT_IN_CODES = new Set(BUILT_IN_LOCALES.map((l) => l.code));

/** Flatten nested object to dotted key paths */
function flattenMessages(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenMessages(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = String(value ?? '');
    }
  }
  return result;
}

/** Cache for locale JSON files (loaded once) */
const localeCache = new Map<string, Record<string, string>>();

function loadLocaleFile(code: string): Record<string, string> | null {
  if (localeCache.has(code)) return localeCache.get(code)!;

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const filePath = join(__dirname, '..', '..', '..', 'dashboard', 'src', 'i18n', 'locales', `${code}.json`);
    const raw = readFileSync(filePath, 'utf-8');
    const nested = JSON.parse(raw) as Record<string, unknown>;
    const flat = flattenMessages(nested);
    localeCache.set(code, flat);
    return flat;
  } catch (err) {
    logger.warn({ err, code }, 'Failed to load locale file');
    return null;
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

async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const row = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, key),
  });
  return row ? (row.value as T) : null;
}

async function getOverrides(locale: string): Promise<Record<string, string>> {
  const val = await getSetting<Record<string, string>>(`i18n:overrides:${locale}`);
  return val ?? {};
}

async function getCustomLocales(): Promise<{ code: string; name: string }[]> {
  const val = await getSetting<{ code: string; name: string }[]>('i18n:custom_locales');
  return val ?? [];
}

// ── Schemas ──

const localeCodeParamSchema = z.object({
  code: z.string().min(2).max(10).openapi({ description: 'Locale code' }),
});

const createLocaleSchema = z.object({
  code: z.string().min(2).max(10).regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  name: z.string().min(1).max(50),
});

const keysQuerySchema = z.object({
  locale: z.string().default('en').openapi({ description: 'Target locale' }),
  namespace: z.string().optional().openapi({ description: 'Filter by namespace' }),
  search: z.string().optional().openapi({ description: 'Search in keys and values' }),
});

const saveOverridesSchema = z.object({
  overrides: z.record(z.string(), z.string()),
});

const resetKeyParamSchema = z.object({
  locale: z.string().min(2).max(10).openapi({ description: 'Locale code' }),
  key: z.string().min(1).openapi({ description: 'Dotted key path to reset' }),
});

const autoTranslateSchema = z.object({
  sourceLocale: z.string().default('en'),
  targetLocale: z.string(),
  namespace: z.string().optional(),
  overwriteExisting: z.boolean().default(false),
});

// ── Routes ──

// GET /locales
const listLocalesRoute = createRoute({
  method: 'get',
  path: '/locales',
  tags: ['Admin', 'i18n'],
  summary: 'List all available locales',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Locales list'),
    ...standardErrors,
  },
});

adminI18nRoutes.openapi(listLocalesRoute, (async (c: any) => {
  const customLocales = await getCustomLocales();
  const enKeys = loadLocaleFile('en');
  const totalKeys = enKeys ? Object.keys(enKeys).length : 0;

  const builtIn = await Promise.all(
    BUILT_IN_LOCALES.map(async (l) => {
      const overrides = await getOverrides(l.code);
      const staticFile = loadLocaleFile(l.code);
      const staticCount = staticFile ? Object.keys(staticFile).length : 0;
      return {
        ...l,
        builtIn: true,
        totalKeys,
        translatedKeys: staticCount,
        overrideCount: Object.keys(overrides).length,
      };
    }),
  );

  const custom = await Promise.all(
    customLocales.map(async (l) => {
      const overrides = await getOverrides(l.code);
      return {
        ...l,
        builtIn: false,
        totalKeys,
        translatedKeys: Object.keys(overrides).length,
        overrideCount: Object.keys(overrides).length,
      };
    }),
  );

  return c.json({ builtIn, custom });
}) as any);

// POST /locales
const createLocaleRoute = createRoute({
  method: 'post',
  path: '/locales',
  tags: ['Admin', 'i18n'],
  summary: 'Add a custom locale',
  security: bearerSecurity,
  request: { body: jsonBody(createLocaleSchema) },
  responses: {
    200: jsonContent(z.any(), 'Locale created'),
    ...standardErrors,
  },
});

adminI18nRoutes.openapi(createLocaleRoute, (async (c: any) => {
  const { code, name } = c.req.valid('json');

  if (BUILT_IN_CODES.has(code)) {
    return c.json({ error: 'This locale already exists as a built-in locale' }, 400);
  }

  const customLocales = await getCustomLocales();
  if (customLocales.some((l) => l.code === code)) {
    return c.json({ error: 'This locale already exists' }, 400);
  }

  customLocales.push({ code, name });
  await upsertSetting('i18n:custom_locales', customLocales);

  return c.json({ message: 'Locale added', code, name });
}) as any);

// DELETE /locales/:code
const deleteLocaleRoute = createRoute({
  method: 'delete',
  path: '/locales/{code}',
  tags: ['Admin', 'i18n'],
  summary: 'Delete a custom locale',
  security: bearerSecurity,
  request: { params: localeCodeParamSchema },
  responses: {
    200: jsonContent(z.any(), 'Locale deleted'),
    ...standardErrors,
  },
});

adminI18nRoutes.openapi(deleteLocaleRoute, (async (c: any) => {
  const { code } = c.req.valid('param');

  if (BUILT_IN_CODES.has(code)) {
    return c.json({ error: 'Built-in locales cannot be deleted' }, 400);
  }

  const customLocales = await getCustomLocales();
  const filtered = customLocales.filter((l) => l.code !== code);
  if (filtered.length === customLocales.length) {
    return c.json({ error: 'Locale not found' }, 404);
  }

  await upsertSetting('i18n:custom_locales', filtered);

  // Clean up overrides
  const overrideRow = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, `i18n:overrides:${code}`),
  });
  if (overrideRow) {
    await db.delete(platformSettings).where(eq(platformSettings.id, overrideRow.id));
  }

  return c.json({ message: 'Locale deleted' });
}) as any);

// GET /keys
const listKeysRoute = createRoute({
  method: 'get',
  path: '/keys',
  tags: ['Admin', 'i18n'],
  summary: 'Get all translation keys with values for a locale',
  security: bearerSecurity,
  request: { query: keysQuerySchema },
  responses: {
    200: jsonContent(z.any(), 'Translation keys'),
    ...standardErrors,
  },
});

adminI18nRoutes.openapi(listKeysRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const targetLocale = query.locale ?? 'en';
  const namespaceFilter = query.namespace;
  const searchFilter = query.search?.toLowerCase();

  const enKeys = loadLocaleFile('en');
  if (!enKeys) {
    return c.json({ error: 'Failed to load English locale file' }, 500);
  }

  // Load static file for target locale (null for custom locales)
  const staticKeys = BUILT_IN_CODES.has(targetLocale) ? loadLocaleFile(targetLocale) : null;

  // Load DB overrides for target locale
  const overrides = await getOverrides(targetLocale);

  // Build key list based on English keys (the source of truth)
  const allKeys = Object.keys(enKeys);
  const namespaces = [...new Set(allKeys.map((k) => k.split('.')[0]!))].sort();

  const keys: {
    key: string;
    namespace: string;
    en: string;
    value: string | null;
    isOverridden: boolean;
    isBuiltIn: boolean;
  }[] = [];

  for (const key of allKeys) {
    const ns = key.split('.')[0]!;

    // Apply namespace filter
    if (namespaceFilter && ns !== namespaceFilter) continue;

    const enValue = enKeys[key] ?? '';
    const staticValue = staticKeys?.[key] ?? null;
    const overrideValue = overrides[key] ?? null;

    const effectiveValue = overrideValue ?? staticValue;

    // Apply search filter
    if (searchFilter) {
      const matchKey = key.toLowerCase().includes(searchFilter);
      const matchEn = enValue.toLowerCase().includes(searchFilter);
      const matchValue = effectiveValue?.toLowerCase().includes(searchFilter);
      if (!matchKey && !matchEn && !matchValue) continue;
    }

    keys.push({
      key,
      namespace: ns,
      en: enValue,
      value: effectiveValue,
      isOverridden: overrideValue !== null,
      isBuiltIn: staticValue !== null,
    });
  }

  return c.json({ namespaces, keys, totalKeys: allKeys.length });
}) as any);

// PUT /overrides/:locale
const saveOverridesRoute = createRoute({
  method: 'put',
  path: '/overrides/{locale}',
  tags: ['Admin', 'i18n'],
  summary: 'Save translation overrides for a locale',
  security: bearerSecurity,
  request: {
    params: localeCodeParamSchema.extend({ locale: z.string() }).transform((v) => ({ code: (v as any).locale ?? (v as any).code })),
    body: jsonBody(saveOverridesSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Overrides saved'),
    ...standardErrors,
  },
});

adminI18nRoutes.openapi(saveOverridesRoute, (async (c: any) => {
  const locale = c.req.param('locale');
  const { overrides: newOverrides } = c.req.valid('json');

  // Merge with existing overrides
  const existing = await getOverrides(locale);
  const merged = { ...existing, ...newOverrides };

  // Remove keys with empty string values (treat as "reset to default" for built-in locales)
  // For custom locales, keep all keys
  if (BUILT_IN_CODES.has(locale)) {
    const staticKeys = loadLocaleFile(locale);
    for (const [key, value] of Object.entries(merged)) {
      if (staticKeys && value === staticKeys[key]) {
        delete merged[key];
      }
    }
  }

  await upsertSetting(`i18n:overrides:${locale}`, merged);

  return c.json({ message: 'Overrides saved', count: Object.keys(merged).length });
}) as any);

// DELETE /overrides/:locale/:key
const resetKeyRoute = createRoute({
  method: 'delete',
  path: '/overrides/{locale}/{key}',
  tags: ['Admin', 'i18n'],
  summary: 'Reset a single translation key to its default value',
  security: bearerSecurity,
  request: { params: resetKeyParamSchema },
  responses: {
    200: jsonContent(z.any(), 'Key reset'),
    ...standardErrors,
  },
});

adminI18nRoutes.openapi(resetKeyRoute, (async (c: any) => {
  const locale = c.req.param('locale');
  const key = c.req.param('key');

  const overrides = await getOverrides(locale);
  if (!(key in overrides)) {
    return c.json({ message: 'Key is not overridden' });
  }

  delete overrides[key];
  await upsertSetting(`i18n:overrides:${locale}`, overrides);

  return c.json({ message: 'Key reset to default' });
}) as any);

// POST /auto-translate
const autoTranslateI18nRoute = createRoute({
  method: 'post',
  path: '/auto-translate',
  tags: ['Admin', 'i18n'],
  summary: 'Auto-translate UI strings using DeepL',
  security: bearerSecurity,
  request: { body: jsonBody(autoTranslateSchema) },
  responses: {
    200: jsonContent(z.any(), 'Translation results'),
    ...standardErrors,
  },
});

adminI18nRoutes.openapi(autoTranslateI18nRoute, (async (c: any) => {
  const body = c.req.valid('json');

  // Resolve DeepL API key
  let deeplApiKey = process.env['DEEPL_API_KEY'];
  if (!deeplApiKey) {
    const setting = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'translation:deepl_api_key'),
    });
    if (setting) {
      const raw = typeof setting.value === 'string' ? setting.value : (setting.value as any)?.key;
      if (raw) {
        try { deeplApiKey = decrypt(raw); } catch { deeplApiKey = raw; }
      }
    }
  }

  if (!deeplApiKey) {
    return c.json({ error: 'Translation service not configured' }, 501);
  }

  // Detect DeepL endpoint (free vs pro)
  const deeplUrl = deeplApiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  // Load source keys
  const enKeys = loadLocaleFile('en');
  if (!enKeys) {
    return c.json({ error: 'Failed to load English locale file' }, 500);
  }

  const sourceKeys = body.sourceLocale === 'en'
    ? enKeys
    : (loadLocaleFile(body.sourceLocale) ?? enKeys);

  // Get existing values for target locale
  const staticKeys = BUILT_IN_CODES.has(body.targetLocale) ? loadLocaleFile(body.targetLocale) : null;
  const existingOverrides = await getOverrides(body.targetLocale);

  // Determine which keys need translation
  let keysToTranslate: string[] = Object.keys(enKeys);

  // Filter by namespace
  if (body.namespace) {
    keysToTranslate = keysToTranslate.filter((k) => k.startsWith(body.namespace + '.'));
  }

  // Filter out already-translated keys unless overwrite is enabled
  if (!body.overwriteExisting) {
    keysToTranslate = keysToTranslate.filter((k) => {
      const hasOverride = k in existingOverrides;
      const hasStatic = staticKeys ? k in staticKeys : false;
      return !hasOverride && !hasStatic;
    });
  }

  if (keysToTranslate.length === 0) {
    return c.json({ translated: 0, failed: 0, skipped: 0 });
  }

  // DeepL locale code mapping
  const localeToDeepL: Record<string, string> = { en: 'EN', nb: 'NB', de: 'DE', zh: 'ZH' };
  const sourceLang = localeToDeepL[body.sourceLocale] ?? body.sourceLocale.toUpperCase();
  const targetLang = localeToDeepL[body.targetLocale] ?? body.targetLocale.toUpperCase();

  let translated = 0;
  let failed = 0;
  const skipped = 0;
  const newOverrides: Record<string, string> = {};

  // Batch translate (DeepL supports up to 50 texts per call)
  const BATCH_SIZE = 50;
  for (let i = 0; i < keysToTranslate.length; i += BATCH_SIZE) {
    const batch = keysToTranslate.slice(i, i + BATCH_SIZE);
    const sourceTexts = batch.map((k) => sourceKeys[k] ?? enKeys[k] ?? '');

    try {
      const res = await fetch(deeplUrl, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${deeplApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: sourceTexts,
          target_lang: targetLang,
          source_lang: sourceLang,
        }),
      });

      if (!res.ok) {
        logger.warn({ status: res.status, batch: i }, 'DeepL batch translate failed');
        failed += batch.length;
        continue;
      }

      const data = await res.json() as { translations: { text: string }[] };

      for (let j = 0; j < batch.length; j++) {
        const translatedText = data.translations[j]?.text;
        if (translatedText) {
          newOverrides[batch[j]!] = translatedText;
          translated++;
        } else {
          failed++;
        }
      }
    } catch (err) {
      logger.warn({ err, batch: i }, 'DeepL batch translate error');
      failed += batch.length;
    }
  }

  // Save all new overrides
  if (Object.keys(newOverrides).length > 0) {
    const merged = { ...existingOverrides, ...newOverrides };
    await upsertSetting(`i18n:overrides:${body.targetLocale}`, merged);
  }

  return c.json({ translated, failed, skipped });
}) as any);

export default adminI18nRoutes;
