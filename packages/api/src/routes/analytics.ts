import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, serviceAnalytics, services, eq, and, gte, lte, isNull, sql, getDialect } from '@fleet/db';
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
  avgResponseTimeMs: z.number(),
  p95ResponseTimeMs: z.number(),
  statusBreakdown: z.record(z.string(), z.number()),
});

const previousPeriodSchema = z.object({
  totalRequests: z.number(),
  totalBytesIn: z.number(),
  totalBytesOut: z.number(),
  avgResponseTimeMs: z.number(),
});

const analyticsResponseSchema = z.object({
  data: z.array(analyticsDataPointSchema),
  summary: z.object({
    totalRequests: z.number(),
    totalBytesIn: z.number(),
    totalBytesOut: z.number(),
    avgResponseTimeMs: z.number(),
    p95ResponseTimeMs: z.number(),
  }),
  previousPeriod: previousPeriodSchema.optional(),
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

function getPreviousPeriodCutoff(period: '24h' | '7d' | '30d'): { start: Date; end: Date } {
  const now = Date.now();
  switch (period) {
    case '24h': return { start: new Date(now - 48 * 60 * 60 * 1000), end: new Date(now - 24 * 60 * 60 * 1000) };
    case '7d': return { start: new Date(now - 14 * 24 * 60 * 60 * 1000), end: new Date(now - 7 * 24 * 60 * 60 * 1000) };
    case '30d': return { start: new Date(now - 60 * 24 * 60 * 60 * 1000), end: new Date(now - 30 * 24 * 60 * 60 * 1000) };
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
    avgResponseTimeMs: sql<number>`avg(${serviceAnalytics.avgResponseTimeMs})`.as('avg_rt'),
    p95ResponseTimeMs: sql<number>`max(${serviceAnalytics.p95ResponseTimeMs})`.as('p95_rt'),
    ioReadBytes: sql<number>`COALESCE(sum(${serviceAnalytics.ioReadBytes}), 0)`.as('io_read'),
    ioWriteBytes: sql<number>`COALESCE(sum(${serviceAnalytics.ioWriteBytes}), 0)`.as('io_write'),
  })
    .from(serviceAnalytics)
    .where(and(
      eq(serviceAnalytics.serviceId, serviceId),
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
      avgResponseTimeMs: Math.round(Number(r.avgResponseTimeMs) || 0),
      p95ResponseTimeMs: Math.round(Number(r.p95ResponseTimeMs) || 0),
      ioReadBytes: Number(r.ioReadBytes) || 0,
      ioWriteBytes: Number(r.ioWriteBytes) || 0,
      statusBreakdown: {
        '2xx': Number(r.requests2xx) || 0,
        '3xx': Number(r.requests3xx) || 0,
        '4xx': Number(r.requests4xx) || 0,
        '5xx': Number(r.requests5xx) || 0,
      },
    };
  });

  const totalRequests = data.reduce((a, d) => a + d.requests, 0);
  const totalBytesIn = data.reduce((a, d) => a + d.bytesIn, 0);
  const totalBytesOut = data.reduce((a, d) => a + d.bytesOut, 0);
  const weighedRtSum = data.reduce((a, d) => a + d.avgResponseTimeMs * d.requests, 0);
  const summaryAvgRt = totalRequests > 0 ? Math.round(weighedRtSum / totalRequests) : 0;
  const summaryP95Rt = Math.max(...data.map(d => d.p95ResponseTimeMs), 0);

  const summary = { totalRequests, totalBytesIn, totalBytesOut, avgResponseTimeMs: summaryAvgRt, p95ResponseTimeMs: summaryP95Rt };

  // Previous period comparison
  const prev = getPreviousPeriodCutoff(period);
  const [prevRow] = await db.select({
    requests: sql<number>`sum(${serviceAnalytics.requests})`.as('requests'),
    bytesIn: sql<number>`sum(${serviceAnalytics.bytesIn})`.as('bytes_in'),
    bytesOut: sql<number>`sum(${serviceAnalytics.bytesOut})`.as('bytes_out'),
    avgRt: sql<number>`avg(${serviceAnalytics.avgResponseTimeMs})`.as('avg_rt'),
  })
    .from(serviceAnalytics)
    .where(and(
      eq(serviceAnalytics.serviceId, serviceId),
      gte(serviceAnalytics.recordedAt, prev.start),
      lte(serviceAnalytics.recordedAt, prev.end),
    ));

  const previousPeriod = prevRow ? {
    totalRequests: Number(prevRow.requests) || 0,
    totalBytesIn: Number(prevRow.bytesIn) || 0,
    totalBytesOut: Number(prevRow.bytesOut) || 0,
    avgResponseTimeMs: Math.round(Number(prevRow.avgRt) || 0),
  } : undefined;

  return c.json({ data, summary, previousPeriod });
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
    avgResponseTimeMs: sql<number>`avg(${serviceAnalytics.avgResponseTimeMs})`.as('avg_rt'),
    p95ResponseTimeMs: sql<number>`max(${serviceAnalytics.p95ResponseTimeMs})`.as('p95_rt'),
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
      avgResponseTimeMs: Math.round(Number(r.avgResponseTimeMs) || 0),
      p95ResponseTimeMs: Math.round(Number(r.p95ResponseTimeMs) || 0),
      statusBreakdown: {
        '2xx': Number(r.requests2xx) || 0,
        '3xx': Number(r.requests3xx) || 0,
        '4xx': Number(r.requests4xx) || 0,
        '5xx': Number(r.requests5xx) || 0,
      },
    };
  });

  const totalRequests = data.reduce((a, d) => a + d.requests, 0);
  const totalBytesIn = data.reduce((a, d) => a + d.bytesIn, 0);
  const totalBytesOut = data.reduce((a, d) => a + d.bytesOut, 0);
  const weighedRtSum = data.reduce((a, d) => a + d.avgResponseTimeMs * d.requests, 0);
  const summaryAvgRt = totalRequests > 0 ? Math.round(weighedRtSum / totalRequests) : 0;
  const summaryP95Rt = Math.max(...data.map(d => d.p95ResponseTimeMs), 0);

  const summary = { totalRequests, totalBytesIn, totalBytesOut, avgResponseTimeMs: summaryAvgRt, p95ResponseTimeMs: summaryP95Rt };

  // Previous period comparison
  const prev = getPreviousPeriodCutoff(period);
  const [prevRow] = await db.select({
    requests: sql<number>`sum(${serviceAnalytics.requests})`.as('requests'),
    bytesIn: sql<number>`sum(${serviceAnalytics.bytesIn})`.as('bytes_in'),
    bytesOut: sql<number>`sum(${serviceAnalytics.bytesOut})`.as('bytes_out'),
    avgRt: sql<number>`avg(${serviceAnalytics.avgResponseTimeMs})`.as('avg_rt'),
  })
    .from(serviceAnalytics)
    .where(and(
      eq(serviceAnalytics.accountId, accountId),
      gte(serviceAnalytics.recordedAt, prev.start),
      lte(serviceAnalytics.recordedAt, prev.end),
    ));

  const previousPeriod = prevRow ? {
    totalRequests: Number(prevRow.requests) || 0,
    totalBytesIn: Number(prevRow.bytesIn) || 0,
    totalBytesOut: Number(prevRow.bytesOut) || 0,
    avgResponseTimeMs: Math.round(Number(prevRow.avgRt) || 0),
  } : undefined;

  return c.json({ data, summary, previousPeriod });
}) as any);

// ── SSE Live Analytics ───────────────────────────────────────────────────

analyticsRoutes.get('/live', async (c: any) => {
  const accountId = c.get('accountId');

  return c.newResponse(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let running = true;

        const send = (data: any) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            running = false;
          }
        };

        const poll = async () => {
          while (running) {
            try {
              // Get the last 5 minutes of data
              const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
              const [row] = await db.select({
                requests: sql<number>`sum(${serviceAnalytics.requests})`.as('requests'),
                bytesIn: sql<number>`sum(${serviceAnalytics.bytesIn})`.as('bytes_in'),
                bytesOut: sql<number>`sum(${serviceAnalytics.bytesOut})`.as('bytes_out'),
                avgRt: sql<number>`avg(${serviceAnalytics.avgResponseTimeMs})`.as('avg_rt'),
                activeServices: sql<number>`count(distinct ${serviceAnalytics.serviceId})`.as('active'),
              })
                .from(serviceAnalytics)
                .where(and(
                  eq(serviceAnalytics.accountId, accountId),
                  gte(serviceAnalytics.recordedAt, fiveMinAgo),
                ));

              send({
                requests: Number(row?.requests) || 0,
                bytesIn: Number(row?.bytesIn) || 0,
                bytesOut: Number(row?.bytesOut) || 0,
                avgResponseTimeMs: Math.round(Number(row?.avgRt) || 0),
                activeServices: Number(row?.activeServices) || 0,
                timestamp: new Date().toISOString(),
              });
            } catch {
              // Ignore DB errors in SSE loop
            }

            // Wait 10 seconds before next poll
            await new Promise(resolve => setTimeout(resolve, 10_000));
          }
        };

        poll().catch(() => {});
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    },
  );
});

// GET /volumes/:volumeName — volume I/O analytics
const getVolumeIoRoute = createRoute({
  method: 'get',
  path: '/volumes/{volumeName}',
  tags: ['Analytics'],
  summary: 'Get I/O analytics for a volume',
  security: bearerSecurity,
  request: {
    params: z.object({ volumeName: z.string() }),
    query: periodQuerySchema,
  },
  responses: {
    200: jsonContent(z.object({
      data: z.array(z.object({
        timestamp: z.string(),
        ioReadBytes: z.number(),
        ioWriteBytes: z.number(),
      })),
      summary: z.object({
        totalReadBytes: z.number(),
        totalWriteBytes: z.number(),
        peakReadBytesPerInterval: z.number(),
        peakWriteBytesPerInterval: z.number(),
      }),
      services: z.array(z.object({
        id: z.string(),
        name: z.string(),
      })),
    }), 'Volume I/O analytics'),
    ...standardErrors,
  },
});

analyticsRoutes.openapi(getVolumeIoRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { volumeName } = c.req.valid('param');
  const { period } = c.req.valid('query');
  const cutoff = getPeriodCutoff(period);
  const bucketSeconds = getBucketSeconds(period);
  const bucket = timeBucketExpr(bucketSeconds);

  // Find all services that use this volume
  const accountServices = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
    columns: { id: true, name: true, volumes: true },
  });

  const matchingServices = accountServices.filter((svc: any) => {
    const vols = svc.volumes as Array<{ source: string }> | null;
    return vols?.some(v => v.source === volumeName);
  });

  if (matchingServices.length === 0) {
    return c.json({
      data: [],
      summary: { totalReadBytes: 0, totalWriteBytes: 0, peakReadBytesPerInterval: 0, peakWriteBytesPerInterval: 0 },
      services: [],
    });
  }

  const serviceIds = matchingServices.map(s => s.id);

  // Aggregate I/O data bucketed by time across all services using this volume
  const rows = await db
    .select({
      bucket,
      ioReadBytes: sql<number>`COALESCE(SUM(${serviceAnalytics.ioReadBytes}), 0)`,
      ioWriteBytes: sql<number>`COALESCE(SUM(${serviceAnalytics.ioWriteBytes}), 0)`,
    })
    .from(serviceAnalytics)
    .where(and(
      sql`${serviceAnalytics.serviceId} IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`, `)})`,
      isSqlite
        ? gte(serviceAnalytics.recordedAt, cutoff)
        : gte(serviceAnalytics.recordedAt, cutoff),
    ))
    .groupBy(bucket)
    .orderBy(bucket);

  const data = rows.map((r: any) => ({
    timestamp: isSqlite
      ? new Date(r.bucket * 1000).toISOString()
      : new Date(r.bucket).toISOString(),
    ioReadBytes: Number(r.ioReadBytes),
    ioWriteBytes: Number(r.ioWriteBytes),
  }));

  let totalRead = 0, totalWrite = 0, peakRead = 0, peakWrite = 0;
  for (const d of data) {
    totalRead += d.ioReadBytes;
    totalWrite += d.ioWriteBytes;
    if (d.ioReadBytes > peakRead) peakRead = d.ioReadBytes;
    if (d.ioWriteBytes > peakWrite) peakWrite = d.ioWriteBytes;
  }

  return c.json({
    data,
    summary: {
      totalReadBytes: totalRead,
      totalWriteBytes: totalWrite,
      peakReadBytesPerInterval: peakRead,
      peakWriteBytesPerInterval: peakWrite,
    },
    services: matchingServices.map(s => ({ id: s.id, name: s.name })),
  });
}) as any);

export default analyticsRoutes;
