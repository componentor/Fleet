import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, serviceAnalytics, services, eq, and, gte, isNull, sql, getDialect } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { jsonContent, standardErrors, bearerSecurity } from './_schemas.js';

const isSqlite = getDialect() === 'sqlite';

const analyticsRoutes = new OpenAPIHono<{
  Variables: { user: AuthUser; accountId: string };
}>();

analyticsRoutes.use('*', authMiddleware);
analyticsRoutes.use('*', tenantMiddleware);

// ── Schemas ──────────────────────────────────────────────────────────────

const periodQuerySchema = z.object({
  period: z.enum(['24h', '7d', '30d']).default('24h'),
});

const analyticsDataPointSchema = z.object({
  timestamp: z.string(),
  requests: z.number(),
  bytesIn: z.number(),
  bytesOut: z.number(),
  statusBreakdown: z.record(z.string(), z.number()),
});

const analyticsResponseSchema = z.object({
  data: z.array(analyticsDataPointSchema),
  summary: z.object({
    totalRequests: z.number(),
    totalBytesIn: z.number(),
    totalBytesOut: z.number(),
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

/**
 * Dialect-specific SQL expression for time bucketing.
 */
function timeBucketExpr(bucketSeconds: number) {
  const dialect = getDialect();
  if (dialect === 'pg') {
    return sql`to_timestamp(floor(extract(epoch from ${serviceAnalytics.recordedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;
  } else if (dialect === 'mysql') {
    return sql`FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${serviceAnalytics.recordedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;
  } else {
    // SQLite: recordedAt stored as unix timestamp integer
    return sql`(${serviceAnalytics.recordedAt} / ${bucketSeconds}) * ${bucketSeconds}`;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────

const getServiceAnalyticsRoute = createRoute({
  method: 'get',
  path: '/services/{id}',
  tags: ['Analytics'],
  summary: 'Get analytics for a service',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: periodQuerySchema,
  },
  responses: {
    200: jsonContent(analyticsResponseSchema, 'Service analytics'),
    ...standardErrors,
  },
});

analyticsRoutes.openapi(getServiceAnalyticsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');
  const { period } = c.req.valid('query');

  // Verify service belongs to this account
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
    columns: { id: true },
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  const cutoff = getPeriodCutoff(period);
  const bucketSeconds = getBucketSeconds(period);
  const bucket = timeBucketExpr(bucketSeconds);

  // SQL aggregation — bounded result set (max 288 for 24h, 168 for 7d, 30 for 30d)
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
      eq(serviceAnalytics.serviceId, serviceId),
      gte(serviceAnalytics.recordedAt, cutoff),
    ))
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  const data = rows.map((r) => {
    // SQLite timeBucketExpr returns unix seconds; PG/MySQL return Date-like values
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

  const summary = {
    totalRequests: data.reduce((a, d) => a + d.requests, 0),
    totalBytesIn: data.reduce((a, d) => a + d.bytesIn, 0),
    totalBytesOut: data.reduce((a, d) => a + d.bytesOut, 0),
  };

  return c.json({ data, summary });
}) as any);

const getAccountAnalyticsRoute = createRoute({
  method: 'get',
  path: '/account',
  tags: ['Analytics'],
  summary: 'Get aggregate analytics for all account services',
  security: bearerSecurity,
  request: {
    query: periodQuerySchema,
  },
  responses: {
    200: jsonContent(analyticsResponseSchema, 'Account analytics'),
    ...standardErrors,
  },
});

analyticsRoutes.openapi(getAccountAnalyticsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { period } = c.req.valid('query');
  const cutoff = getPeriodCutoff(period);
  const bucketSeconds = getBucketSeconds(period);
  const bucket = timeBucketExpr(bucketSeconds);

  // SQL aggregation — bounded result set regardless of service count
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

  const summary = {
    totalRequests: data.reduce((a, d) => a + d.requests, 0),
    totalBytesIn: data.reduce((a, d) => a + d.bytesIn, 0),
    totalBytesOut: data.reduce((a, d) => a + d.bytesOut, 0),
  };

  return c.json({ data, summary });
}) as any);

export default analyticsRoutes;
