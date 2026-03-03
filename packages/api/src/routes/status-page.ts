import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import {
  db,
  statusPosts,
  statusPostTranslations,
  uptimeSnapshots,
  eq,
  desc,
  or,
  gte,
} from '@fleet/db';
import { orchestrator } from '../services/orchestrator.js';
import { getValkey } from '../services/valkey.service.js';
import { storageManager } from '../services/storage/storage-manager.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { jsonContent, standardErrors, noSecurity } from './_schemas.js';

const statusPage = new OpenAPIHono();

// ── Rate limiting: 30 requests per 60 seconds ──

statusPage.use('*', rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'status-page' }));

// ── Shared types ──

type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'not_configured';

// ══════════════════════════════════════════════════════════════════════════════
// GET /health — Live health check for core services
// ══════════════════════════════════════════════════════════════════════════════

const serviceHealthSchema = z.object({
  key: z.string(),
  status: z.enum(['healthy', 'degraded', 'down', 'not_configured']),
  responseMs: z.number().nullable(),
}).openapi('ServiceHealth');

const healthResponseSchema = z.object({
  services: z.array(serviceHealthSchema),
  overall: z.enum(['healthy', 'degraded', 'down']),
}).openapi('HealthResponse');

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Status Page'],
  summary: 'Get current health of core services',
  security: noSecurity,
  responses: {
    200: jsonContent(healthResponseSchema, 'Current service health'),
    500: standardErrors[500],
  },
});

statusPage.openapi(healthRoute, (async (c: any) => {
  const services: Array<{ key: string; status: ServiceStatus; responseMs: number | null }> = [];

  // API — always healthy (if you can read this, the API is up)
  services.push({ key: 'api', status: 'healthy', responseMs: null });

  // Docker — try getSwarmInfo
  {
    const start = Date.now();
    let status: ServiceStatus = 'healthy';
    let responseMs: number | null = null;
    try {
      await orchestrator.getClusterInfo();
      responseMs = Date.now() - start;
    } catch {
      status = 'down';
      responseMs = Date.now() - start;
    }
    services.push({ key: 'docker', status, responseMs });
  }

  // Queue (Valkey) — try ping (distinguish "not configured" from "down")
  {
    const start = Date.now();
    let status: ServiceStatus = 'healthy';
    let responseMs: number | null = null;
    try {
      const valkey = await getValkey();
      if (!valkey) {
        status = 'not_configured';
      } else {
        await valkey.ping();
        responseMs = Date.now() - start;
      }
    } catch {
      status = 'down';
      responseMs = Date.now() - start;
    }
    services.push({ key: 'queue', status, responseMs });
  }

  // Storage — try getHealth, map status
  {
    const start = Date.now();
    let status: ServiceStatus = 'healthy';
    let responseMs: number | null = null;
    try {
      const health = await storageManager.getHealth();
      responseMs = Date.now() - start;
      const volumeStatus = health.volumes.status;
      if (volumeStatus === 'degraded') {
        status = 'degraded';
      } else if (volumeStatus === 'error' || volumeStatus === 'unavailable') {
        status = 'down';
      }
    } catch {
      status = 'down';
      responseMs = Date.now() - start;
    }
    services.push({ key: 'storage', status, responseMs });
  }

  // Compute overall status (ignore services that aren't configured)
  const configured = services.filter((s) => s.status !== 'not_configured');
  const hasDown = configured.some((s) => s.status === 'down');
  const hasDegraded = configured.some((s) => s.status === 'degraded');
  const overall: 'healthy' | 'degraded' | 'down' = hasDown ? 'down' : hasDegraded ? 'degraded' : 'healthy';

  return c.json({ services, overall }, 200);
}) as any);

// ══════════════════════════════════════════════════════════════════════════════
// GET /posts — Published status posts with locale-specific translation
// ══════════════════════════════════════════════════════════════════════════════

const statusPostItemSchema = z.object({
  id: z.string(),
  icon: z.string(),
  severity: z.string(),
  affectedServices: z.any(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  title: z.string(),
  body: z.string(),
}).openapi('StatusPostItem');

const postsResponseSchema = z.object({
  data: z.array(statusPostItemSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
}).openapi('StatusPostsResponse');

const postsRoute = createRoute({
  method: 'get',
  path: '/posts',
  tags: ['Status Page'],
  summary: 'List published status posts with locale-specific translation',
  security: noSecurity,
  request: {
    query: z.object({
      locale: z.string().default('en').optional(),
      page: z.string().default('1').optional(),
      limit: z.string().default('10').optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: jsonContent(postsResponseSchema, 'Paginated status posts'),
    500: standardErrors[500],
  },
});

statusPage.openapi(postsRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const locale = query.locale || 'en';
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.min(20, Math.max(1, parseInt(query.limit || '10', 10)));
  const search = query.search?.trim() || null;
  const offset = (page - 1) * limit;

  // 1. Fetch published posts ordered by publishedAt DESC
  const publishedPosts = await db
    .select()
    .from(statusPosts)
    .where(eq(statusPosts.status, 'published'))
    .orderBy(desc(statusPosts.publishedAt));

  // 2. For each post, get translation for requested locale (fall back to 'en')
  const allTranslations = await db
    .select()
    .from(statusPostTranslations)
    .where(
      or(
        eq(statusPostTranslations.locale, locale),
        eq(statusPostTranslations.locale, 'en'),
      ),
    );

  // Index translations by postId + locale
  const translationMap = new Map<string, typeof allTranslations[number]>();
  for (const t of allTranslations) {
    const key = `${t.postId}:${t.locale}`;
    translationMap.set(key, t);
  }

  // 3. Build result set with translations
  let results = publishedPosts.map((post) => {
    const localeTranslation = translationMap.get(`${post.id}:${locale}`);
    const fallbackTranslation = translationMap.get(`${post.id}:en`);
    const translation = localeTranslation || fallbackTranslation;

    return {
      id: post.id,
      icon: post.icon,
      severity: post.severity,
      affectedServices: post.affectedServices,
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
      createdAt: post.createdAt ? post.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: post.updatedAt ? post.updatedAt.toISOString() : new Date().toISOString(),
      title: translation?.title ?? '',
      body: translation?.body ?? '',
    };
  });

  // 4. Apply search filter if provided
  if (search) {
    const lowerSearch = search.toLowerCase();
    results = results.filter(
      (r) =>
        r.title.toLowerCase().includes(lowerSearch) ||
        r.body.toLowerCase().includes(lowerSearch),
    );
  }

  // 5. Paginate
  const total = results.length;
  const totalPages = Math.ceil(total / limit);
  const paginatedData = results.slice(offset, offset + limit);

  return c.json({
    data: paginatedData,
    pagination: { page, limit, total, totalPages },
  }, 200);
}) as any);

// ══════════════════════════════════════════════════════════════════════════════
// GET /uptime — Aggregated uptime data for heatmap display
// ══════════════════════════════════════════════════════════════════════════════

const uptimeDaySchema = z.object({
  date: z.string(),
  uptimePercent: z.number(),
  status: z.enum(['healthy', 'degraded', 'down']),
}).openapi('UptimeDay');

const uptimeServiceSchema = z.object({
  key: z.string(),
  days: z.array(uptimeDaySchema),
}).openapi('UptimeService');

const uptimeResponseSchema = z.object({
  services: z.array(uptimeServiceSchema),
}).openapi('UptimeResponse');

const uptimeRoute = createRoute({
  method: 'get',
  path: '/uptime',
  tags: ['Status Page'],
  summary: 'Get aggregated uptime data for heatmap display',
  security: noSecurity,
  request: {
    query: z.object({
      days: z.string().default('90').optional(),
    }),
  },
  responses: {
    200: jsonContent(uptimeResponseSchema, 'Aggregated uptime data'),
    500: standardErrors[500],
  },
});

statusPage.openapi(uptimeRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const days = Math.min(90, Math.max(1, parseInt(query.days || '90', 10)));

  // Calculate cutoff date
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Fetch all snapshots within the period
  const snapshots = await db
    .select()
    .from(uptimeSnapshots)
    .where(gte(uptimeSnapshots.recordedAt, cutoff));

  // Group by service + date and aggregate in TypeScript
  // Map: serviceKey -> dateStr -> { healthy: number, total: number, worstStatus: string }
  const serviceMap = new Map<string, Map<string, { healthy: number; total: number; worstStatus: string }>>();

  for (const snap of snapshots) {
    const serviceKey = snap.service;
    const recordedAt = snap.recordedAt;
    if (!recordedAt) continue;

    const dateStr = recordedAt.toISOString().slice(0, 10); // YYYY-MM-DD

    if (!serviceMap.has(serviceKey)) {
      serviceMap.set(serviceKey, new Map());
    }
    const dayMap = serviceMap.get(serviceKey)!;

    if (!dayMap.has(dateStr)) {
      dayMap.set(dateStr, { healthy: 0, total: 0, worstStatus: 'healthy' });
    }
    const dayEntry = dayMap.get(dateStr)!;

    dayEntry.total++;
    if (snap.status === 'healthy') {
      dayEntry.healthy++;
    }

    // Track worst status: down > degraded > healthy
    if (snap.status === 'down') {
      dayEntry.worstStatus = 'down';
    } else if (snap.status === 'degraded' && dayEntry.worstStatus !== 'down') {
      dayEntry.worstStatus = 'degraded';
    }
  }

  // Build response
  const servicesResult: Array<{
    key: string;
    days: Array<{ date: string; uptimePercent: number; status: string }>;
  }> = [];

  for (const [serviceKey, dayMap] of serviceMap) {
    const daysResult: Array<{ date: string; uptimePercent: number; status: string }> = [];

    // Sort days chronologically
    const sortedDates = Array.from(dayMap.keys()).sort();
    for (const dateStr of sortedDates) {
      const entry = dayMap.get(dateStr)!;
      const uptimePercent = entry.total > 0
        ? Math.round((entry.healthy / entry.total) * 10000) / 100
        : 0;

      daysResult.push({
        date: dateStr,
        uptimePercent,
        status: entry.worstStatus,
      });
    }

    servicesResult.push({ key: serviceKey, days: daysResult });
  }

  // Sort services alphabetically for consistent output
  servicesResult.sort((a, b) => a.key.localeCompare(b.key));

  return c.json({ services: servicesResult }, 200);
}) as any);

export default statusPage;
