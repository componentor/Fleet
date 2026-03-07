import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, serviceAnalytics, visitorAnalytics, services, accounts, eq, and, gte, sql, getDialect } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { loadAdminPermissions, requireAdminPermission } from '../middleware/admin-permission.js';
import type { AdminPermissions } from '../middleware/admin-permission.js';
import { jsonContent, standardErrors, bearerSecurity } from './_schemas.js';

const isSqlite = getDialect() === 'sqlite';

type Env = {
  Variables: { user: AuthUser; adminPermissions: AdminPermissions | null };
};

const adminAnalyticsRoutes = new OpenAPIHono<Env>();

adminAnalyticsRoutes.use('*', authMiddleware);
adminAnalyticsRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper && !user.adminRoleId) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
});
adminAnalyticsRoutes.use('*', loadAdminPermissions);

// ── Schemas ──────────────────────────────────────────────────────────────

const periodQuerySchema = z.object({
  period: z.enum(['24h', '7d', '30d']).default('24h'),
});

const platformAnalyticsSchema = z.object({
  data: z.array(z.object({
    timestamp: z.string(),
    requests: z.number(),
    bytesIn: z.number(),
    bytesOut: z.number(),
    statusBreakdown: z.record(z.string(), z.number()),
  })),
  summary: z.object({
    totalRequests: z.number(),
    totalBytesIn: z.number(),
    totalBytesOut: z.number(),
    activeServices: z.number(),
    topServices: z.array(z.object({
      serviceId: z.string(),
      serviceName: z.string().nullable(),
      accountName: z.string().nullable(),
      requests: z.number(),
      bytesIn: z.number(),
      bytesOut: z.number(),
    })),
  }),
});

// ── Helpers ──────────────────────────────────────────────────────────────

function getPeriodCutoff(period: '24h' | '7d' | '30d'): Date {
  const now = Date.now();
  switch (period) {
    case '24h': return new Date(now - 24 * 60 * 60 * 1000);
    case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }
}

function getBucketSeconds(period: '24h' | '7d' | '30d'): number {
  switch (period) {
    case '24h': return 300;    // 5 min
    case '7d': return 3600;    // 1 hour
    case '30d': return 86400;  // 1 day
  }
}

function timeBucketExpr(bucketSeconds: number) {
  const dialect = getDialect();
  if (dialect === 'pg') {
    return sql`to_timestamp(floor(extract(epoch from ${serviceAnalytics.recordedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;
  } else if (dialect === 'mysql') {
    return sql`FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${serviceAnalytics.recordedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;
  } else {
    return sql`(${serviceAnalytics.recordedAt} / ${bucketSeconds}) * ${bucketSeconds}`;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────

// Platform-wide analytics (all services, all accounts)
const getPlatformAnalyticsRoute = createRoute({
  method: 'get',
  path: '/platform',
  tags: ['Admin Analytics'],
  summary: 'Get platform-wide analytics across all services',
  security: bearerSecurity,
  request: {
    query: periodQuerySchema,
  },
  responses: {
    200: jsonContent(platformAnalyticsSchema, 'Platform analytics'),
    ...standardErrors,
  },
});

adminAnalyticsRoutes.openapi(getPlatformAnalyticsRoute, (async (c: any) => {
  const { period } = c.req.valid('query');
  const cutoff = getPeriodCutoff(period);
  const bucketSeconds = getBucketSeconds(period);
  const bucket = timeBucketExpr(bucketSeconds);

  // Time-series aggregation across ALL services
  const rows = await db.select({
    bucket: bucket.as('bucket'),
    requests: sql<number>`sum(${serviceAnalytics.requests})`.as('requests'),
    bytesIn: sql<number>`sum(${serviceAnalytics.bytesIn})`.as('bytes_in'),
    bytesOut: sql<number>`sum(${serviceAnalytics.bytesOut})`.as('bytes_out'),
    requests2xx: sql<number>`sum(${serviceAnalytics.requests2xx})`.as('requests_2xx'),
    requests3xx: sql<number>`sum(${serviceAnalytics.requests3xx})`.as('requests_3xx'),
    requests4xx: sql<number>`sum(${serviceAnalytics.requests4xx})`.as('requests_4xx'),
    requests5xx: sql<number>`sum(${serviceAnalytics.requests5xx})`.as('requests_5xx'),
  })
    .from(serviceAnalytics)
    .where(gte(serviceAnalytics.recordedAt, cutoff))
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  const data = rows.map((r) => {
    const bucketVal = r.bucket as any;
    const ts = isSqlite && typeof bucketVal === 'number'
      ? new Date(bucketVal * 1000)
      : new Date(bucketVal);
    return {
      timestamp: ts.toISOString(),
      requests: Number(r.requests) || 0,
      bytesIn: Number(r.bytesIn) || 0,
      bytesOut: Number(r.bytesOut) || 0,
      statusBreakdown: {
        '2xx': Number(r.requests2xx) || 0,
        '3xx': Number(r.requests3xx) || 0,
        '4xx': Number(r.requests4xx) || 0,
        '5xx': Number(r.requests5xx) || 0,
      },
    };
  });

  // Top services by request count
  const topServicesRows = await db.select({
    serviceId: serviceAnalytics.serviceId,
    serviceName: services.name,
    accountName: accounts.name,
    requests: sql<number>`sum(${serviceAnalytics.requests})`.as('requests'),
    bytesIn: sql<number>`sum(${serviceAnalytics.bytesIn})`.as('bytes_in'),
    bytesOut: sql<number>`sum(${serviceAnalytics.bytesOut})`.as('bytes_out'),
  })
    .from(serviceAnalytics)
    .leftJoin(services, eq(serviceAnalytics.serviceId, services.id))
    .leftJoin(accounts, eq(serviceAnalytics.accountId, accounts.id))
    .where(gte(serviceAnalytics.recordedAt, cutoff))
    .groupBy(serviceAnalytics.serviceId, services.name, accounts.name)
    .orderBy(sql`requests DESC`)
    .limit(20);

  // Count distinct active services in period
  const [activeCount] = await db.select({
    count: sql<number>`count(distinct ${serviceAnalytics.serviceId})`.as('count'),
  })
    .from(serviceAnalytics)
    .where(gte(serviceAnalytics.recordedAt, cutoff));

  const summary = {
    totalRequests: data.reduce((a, d) => a + d.requests, 0),
    totalBytesIn: data.reduce((a, d) => a + d.bytesIn, 0),
    totalBytesOut: data.reduce((a, d) => a + d.bytesOut, 0),
    activeServices: Number(activeCount?.count) || 0,
    topServices: topServicesRows.map((r) => ({
      serviceId: r.serviceId,
      serviceName: r.serviceName ?? null,
      accountName: r.accountName ?? null,
      requests: Number(r.requests) || 0,
      bytesIn: Number(r.bytesIn) || 0,
      bytesOut: Number(r.bytesOut) || 0,
    })),
  };

  return c.json({ data, summary });
}) as any);

// Per-account analytics for admin drill-down
const getAdminAccountAnalyticsRoute = createRoute({
  method: 'get',
  path: '/accounts/:accountId',
  tags: ['Admin Analytics'],
  summary: 'Get analytics for a specific account (admin)',
  security: bearerSecurity,
  request: {
    params: z.object({ accountId: z.string().uuid() }),
    query: periodQuerySchema,
  },
  responses: {
    200: jsonContent(platformAnalyticsSchema, 'Account analytics'),
    ...standardErrors,
  },
});

adminAnalyticsRoutes.openapi(getAdminAccountAnalyticsRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const { period } = c.req.valid('query');
  const cutoff = getPeriodCutoff(period);
  const bucketSeconds = getBucketSeconds(period);
  const bucket = timeBucketExpr(bucketSeconds);

  const rows = await db.select({
    bucket: bucket.as('bucket'),
    requests: sql<number>`sum(${serviceAnalytics.requests})`.as('requests'),
    bytesIn: sql<number>`sum(${serviceAnalytics.bytesIn})`.as('bytes_in'),
    bytesOut: sql<number>`sum(${serviceAnalytics.bytesOut})`.as('bytes_out'),
    requests2xx: sql<number>`sum(${serviceAnalytics.requests2xx})`.as('requests_2xx'),
    requests3xx: sql<number>`sum(${serviceAnalytics.requests3xx})`.as('requests_3xx'),
    requests4xx: sql<number>`sum(${serviceAnalytics.requests4xx})`.as('requests_4xx'),
    requests5xx: sql<number>`sum(${serviceAnalytics.requests5xx})`.as('requests_5xx'),
  })
    .from(serviceAnalytics)
    .where(and(
      eq(serviceAnalytics.accountId, accountId),
      gte(serviceAnalytics.recordedAt, cutoff),
    ))
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  const data = rows.map((r) => {
    const bucketVal = r.bucket as any;
    const ts = isSqlite && typeof bucketVal === 'number'
      ? new Date(bucketVal * 1000)
      : new Date(bucketVal);
    return {
      timestamp: ts.toISOString(),
      requests: Number(r.requests) || 0,
      bytesIn: Number(r.bytesIn) || 0,
      bytesOut: Number(r.bytesOut) || 0,
      statusBreakdown: {
        '2xx': Number(r.requests2xx) || 0,
        '3xx': Number(r.requests3xx) || 0,
        '4xx': Number(r.requests4xx) || 0,
        '5xx': Number(r.requests5xx) || 0,
      },
    };
  });

  const topServicesRows = await db.select({
    serviceId: serviceAnalytics.serviceId,
    serviceName: services.name,
    requests: sql<number>`sum(${serviceAnalytics.requests})`.as('requests'),
    bytesIn: sql<number>`sum(${serviceAnalytics.bytesIn})`.as('bytes_in'),
    bytesOut: sql<number>`sum(${serviceAnalytics.bytesOut})`.as('bytes_out'),
  })
    .from(serviceAnalytics)
    .leftJoin(services, eq(serviceAnalytics.serviceId, services.id))
    .where(and(
      eq(serviceAnalytics.accountId, accountId),
      gte(serviceAnalytics.recordedAt, cutoff),
    ))
    .groupBy(serviceAnalytics.serviceId, services.name)
    .orderBy(sql`requests DESC`)
    .limit(20);

  const [activeCount] = await db.select({
    count: sql<number>`count(distinct ${serviceAnalytics.serviceId})`.as('count'),
  })
    .from(serviceAnalytics)
    .where(and(
      eq(serviceAnalytics.accountId, accountId),
      gte(serviceAnalytics.recordedAt, cutoff),
    ));

  const acct = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { name: true },
  });

  const summary = {
    totalRequests: data.reduce((a, d) => a + d.requests, 0),
    totalBytesIn: data.reduce((a, d) => a + d.bytesIn, 0),
    totalBytesOut: data.reduce((a, d) => a + d.bytesOut, 0),
    activeServices: Number(activeCount?.count) || 0,
    topServices: topServicesRows.map((r) => ({
      serviceId: r.serviceId,
      serviceName: r.serviceName ?? null,
      accountName: acct?.name ?? null,
      requests: Number(r.requests) || 0,
      bytesIn: Number(r.bytesIn) || 0,
      bytesOut: Number(r.bytesOut) || 0,
    })),
  };

  return c.json({ data, summary });
}) as any);

// ── Visitor Analytics ────────────────────────────────────────────────────

const visitorAnalyticsResponseSchema = z.object({
  data: z.array(z.object({
    timestamp: z.string(),
    uniqueVisitors: z.number(),
    pageViews: z.number(),
  })),
  summary: z.object({
    totalUniqueVisitors: z.number(),
    totalPageViews: z.number(),
    activeServices: z.number(),
    topPaths: z.array(z.object({ path: z.string(), count: z.number() })),
    topReferrers: z.array(z.object({ referrer: z.string(), count: z.number() })),
    browsers: z.record(z.string(), z.number()),
    devices: z.record(z.string(), z.number()),
    topServices: z.array(z.object({
      serviceId: z.string(),
      serviceName: z.string().nullable(),
      accountName: z.string().nullable(),
      uniqueVisitors: z.number(),
      pageViews: z.number(),
    })),
  }),
});

const getVisitorAnalyticsRoute = createRoute({
  method: 'get',
  path: '/visitors',
  tags: ['Admin Analytics'],
  summary: 'Get platform-wide visitor analytics from access logs',
  security: bearerSecurity,
  request: { query: periodQuerySchema },
  responses: {
    200: jsonContent(visitorAnalyticsResponseSchema, 'Visitor analytics'),
    ...standardErrors,
  },
});

adminAnalyticsRoutes.openapi(getVisitorAnalyticsRoute, (async (c: any) => {
  const { period } = c.req.valid('query');
  const cutoff = getPeriodCutoff(period);
  const bucketSeconds = getBucketSeconds(period);

  // Time-bucketed visitor data
  const dialect = getDialect();
  let bucketExpr;
  if (dialect === 'pg') {
    bucketExpr = sql`to_timestamp(floor(extract(epoch from ${visitorAnalytics.recordedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;
  } else if (dialect === 'mysql') {
    bucketExpr = sql`FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${visitorAnalytics.recordedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;
  } else {
    bucketExpr = sql`(${visitorAnalytics.recordedAt} / ${bucketSeconds}) * ${bucketSeconds}`;
  }

  const rows = await db.select({
    bucket: bucketExpr.as('bucket'),
    uniqueVisitors: sql<number>`sum(${visitorAnalytics.uniqueVisitors})`.as('unique_visitors'),
    pageViews: sql<number>`sum(${visitorAnalytics.pageViews})`.as('page_views'),
  })
    .from(visitorAnalytics)
    .where(gte(visitorAnalytics.recordedAt, cutoff))
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  const data = rows.map((r) => {
    const bucketVal = r.bucket as any;
    const ts = isSqlite && typeof bucketVal === 'number'
      ? new Date(bucketVal * 1000)
      : new Date(bucketVal);
    return {
      timestamp: ts.toISOString(),
      uniqueVisitors: Number(r.uniqueVisitors) || 0,
      pageViews: Number(r.pageViews) || 0,
    };
  });

  // Aggregate JSON fields from raw rows for top paths, referrers, browsers, devices
  const rawRows = await db.select({
    topPaths: visitorAnalytics.topPaths,
    topReferrers: visitorAnalytics.topReferrers,
    browsers: visitorAnalytics.browsers,
    devices: visitorAnalytics.devices,
  })
    .from(visitorAnalytics)
    .where(gte(visitorAnalytics.recordedAt, cutoff));

  // Merge top paths
  const pathMap = new Map<string, number>();
  const referrerMap = new Map<string, number>();
  const browserMap: Record<string, number> = {};
  const deviceMap: Record<string, number> = {};

  for (const row of rawRows) {
    const paths = (Array.isArray(row.topPaths) ? row.topPaths : []) as Array<{ path: string; count: number }>;
    for (const p of paths) {
      pathMap.set(p.path, (pathMap.get(p.path) ?? 0) + p.count);
    }
    const refs = (Array.isArray(row.topReferrers) ? row.topReferrers : []) as Array<{ referrer: string; count: number }>;
    for (const r of refs) {
      referrerMap.set(r.referrer, (referrerMap.get(r.referrer) ?? 0) + r.count);
    }
    const brow = (row.browsers && typeof row.browsers === 'object' ? row.browsers : {}) as Record<string, number>;
    for (const [k, v] of Object.entries(brow)) {
      browserMap[k] = (browserMap[k] ?? 0) + (Number(v) || 0);
    }
    const dev = (row.devices && typeof row.devices === 'object' ? row.devices : {}) as Record<string, number>;
    for (const [k, v] of Object.entries(dev)) {
      deviceMap[k] = (deviceMap[k] ?? 0) + (Number(v) || 0);
    }
  }

  const topPaths = [...pathMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([path, count]) => ({ path, count }));
  const topReferrers = [...referrerMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([referrer, count]) => ({ referrer, count }));

  // Top services
  const topSvcRows = await db.select({
    serviceId: visitorAnalytics.serviceId,
    serviceName: services.name,
    accountName: accounts.name,
    uniqueVisitors: sql<number>`sum(${visitorAnalytics.uniqueVisitors})`.as('uv'),
    pageViews: sql<number>`sum(${visitorAnalytics.pageViews})`.as('pv'),
  })
    .from(visitorAnalytics)
    .leftJoin(services, eq(visitorAnalytics.serviceId, services.id))
    .leftJoin(accounts, eq(visitorAnalytics.accountId, accounts.id))
    .where(gte(visitorAnalytics.recordedAt, cutoff))
    .groupBy(visitorAnalytics.serviceId, services.name, accounts.name)
    .orderBy(sql`pv DESC`)
    .limit(20);

  // Active services count
  const [activeCount] = await db.select({
    count: sql<number>`count(distinct ${visitorAnalytics.serviceId})`.as('count'),
  })
    .from(visitorAnalytics)
    .where(gte(visitorAnalytics.recordedAt, cutoff));

  const summary = {
    totalUniqueVisitors: data.reduce((a, d) => a + d.uniqueVisitors, 0),
    totalPageViews: data.reduce((a, d) => a + d.pageViews, 0),
    activeServices: Number(activeCount?.count) || 0,
    topPaths,
    topReferrers,
    browsers: browserMap,
    devices: deviceMap,
    topServices: topSvcRows.map((r) => ({
      serviceId: r.serviceId,
      serviceName: r.serviceName ?? null,
      accountName: r.accountName ?? null,
      uniqueVisitors: Number(r.uniqueVisitors) || 0,
      pageViews: Number(r.pageViews) || 0,
    })),
  };

  return c.json({ data, summary });
}) as any);

// ── Diagnostics ──────────────────────────────────────────────────────────

const getDiagnosticsRoute = createRoute({
  method: 'get',
  path: '/diagnostics',
  tags: ['Admin Analytics'],
  summary: 'Run analytics pipeline diagnostics',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Diagnostics result'),
    ...standardErrors,
  },
});

adminAnalyticsRoutes.openapi(getDiagnosticsRoute, (async (c: any) => {
  const { analyticsService } = await import('../services/analytics.service.js');
  const result = await analyticsService.runDiagnostics();
  return c.json(result);
}) as any);

// ── Force Collection (trigger manually) ─────────────────────────────────

const forceCollectRoute = createRoute({
  method: 'post',
  path: '/collect',
  tags: ['Admin Analytics'],
  summary: 'Force an immediate analytics collection cycle',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({ ok: z.boolean(), message: z.string() }), 'Collection triggered'),
    ...standardErrors,
  },
});

adminAnalyticsRoutes.openapi(forceCollectRoute, (async (c: any) => {
  const { analyticsService } = await import('../services/analytics.service.js');
  await analyticsService.collectAnalytics();
  return c.json({ ok: true, message: 'Analytics collection cycle completed — check logs for details' });
}) as any);

export default adminAnalyticsRoutes;
