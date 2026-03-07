import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, auditLog, countSql, eq, and, gte, like, desc, sql, getDialect } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { loadAdminPermissions, requireAdminPermission } from '../middleware/admin-permission.js';
import type { AdminPermissions } from '../middleware/admin-permission.js';
import {
  jsonContent,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

type Env = {
  Variables: { user: AuthUser; adminPermissions: AdminPermissions | null };
};

const securityRoutes = new OpenAPIHono<Env>();

securityRoutes.use('*', authMiddleware);
securityRoutes.use('*', loadAdminPermissions);

// Security event type prefixes
const SECURITY_EVENT_TYPES = [
  'auth.login_failed',
  'auth.2fa_failed',
  'auth.region_blocked',
  'auth.brute_force_detected',
  'security.permission_denied',
  'security.admin_permission_denied',
];

const HIGH_RISK_EVENT_TYPES = [
  'user.super_toggled',
  'account.impersonated',
  'account.suspended',
  'account.deleted',
  'account.deletion_scheduled',
  'admin_role.created',
  'admin_role.updated',
  'admin_role.deleted',
  'admin_role.assigned',
  'admin_role.removed',
  'api_key.created',
  'api_key.revoked',
  'settings.updated',
  'user.settings_changed',
  // Infrastructure
  'infra.node_offline',
  'infra.service_down',
  'infra.service_degraded',
  'service.crashed',
];

// ── GET /overview — security dashboard overview ────────────────────

const overviewRoute = createRoute({
  method: 'get',
  path: '/overview',
  tags: ['Security'],
  summary: 'Security monitoring overview with threat indicators',
  security: bearerSecurity,
  request: {
    query: z.object({
      hours: z.string().optional().openapi({ description: 'Lookback period in hours (default 24)' }),
    }),
  },
  middleware: [requireAdminPermission('events', 'read')] as const,
  responses: {
    200: jsonContent(z.any(), 'Security overview data'),
    ...standardErrors,
  },
});

securityRoutes.openapi(overviewRoute, (async (c: any) => {
  const hours = Math.min(168, Math.max(1, parseInt(c.req.valid('query').hours ?? '24', 10)));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // All security events in the period
  const securityEvents = await db
    .select({
      eventType: auditLog.eventType,
      count: countSql(),
    })
    .from(auditLog)
    .where(and(
      gte(auditLog.createdAt, since),
      sql`${auditLog.eventType} LIKE 'auth.%' OR ${auditLog.eventType} LIKE 'security.%'`,
    ))
    .groupBy(auditLog.eventType);

  // Failed logins by IP (top 20 offenders)
  const failedLoginsByIp = await db
    .select({
      ipAddress: auditLog.ipAddress,
      count: countSql(),
    })
    .from(auditLog)
    .where(and(
      gte(auditLog.createdAt, since),
      eq(auditLog.eventType, 'auth.login_failed'),
    ))
    .groupBy(auditLog.ipAddress)
    .orderBy(sql`count(*) DESC`)
    .limit(20);

  // Failed logins by email (top 20 targeted accounts)
  const failedLoginsByEmail = await db
    .select({
      email: auditLog.actorEmail,
      count: countSql(),
    })
    .from(auditLog)
    .where(and(
      gte(auditLog.createdAt, since),
      eq(auditLog.eventType, 'auth.login_failed'),
    ))
    .groupBy(auditLog.actorEmail)
    .orderBy(sql`count(*) DESC`)
    .limit(20);

  // Recent high-risk events
  const highRiskEvents = await db
    .select()
    .from(auditLog)
    .where(and(
      gte(auditLog.createdAt, since),
      sql`${auditLog.eventType} IN (${sql.join(HIGH_RISK_EVENT_TYPES.map(t => sql`${t}`), sql`, `)})`,
    ))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  // Hourly timeline of security events (for chart) — cross-dialect
  const dialect = getDialect();
  const hourBucket =
    dialect === 'pg'
      ? sql`to_timestamp(floor(extract(epoch from ${auditLog.createdAt}) / 3600) * 3600)`
      : dialect === 'mysql'
        ? sql`FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${auditLog.createdAt}) / 3600) * 3600)`
        : sql`datetime((strftime('%s', ${auditLog.createdAt}) / 3600) * 3600, 'unixepoch')`;

  const timeline = await db
    .select({
      hour: hourBucket.as('hour'),
      failedLogins: sql<number>`sum(CASE WHEN ${auditLog.eventType} = 'auth.login_failed' THEN 1 ELSE 0 END)`.as('failed_logins'),
      permissionDenied: sql<number>`sum(CASE WHEN ${auditLog.eventType} LIKE 'security.%' THEN 1 ELSE 0 END)`.as('permission_denied'),
      twoFaFailed: sql<number>`sum(CASE WHEN ${auditLog.eventType} = 'auth.2fa_failed' THEN 1 ELSE 0 END)`.as('two_fa_failed'),
    })
    .from(auditLog)
    .where(and(
      gte(auditLog.createdAt, since),
      sql`${auditLog.eventType} LIKE 'auth.%' OR ${auditLog.eventType} LIKE 'security.%'`,
    ))
    .groupBy(hourBucket)
    .orderBy(hourBucket);

  // Active threat indicators
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // IPs with 10+ failed logins in last hour
  const bruteForceIps = await db
    .select({
      ipAddress: auditLog.ipAddress,
      count: countSql(),
    })
    .from(auditLog)
    .where(and(
      gte(auditLog.createdAt, oneHourAgo),
      eq(auditLog.eventType, 'auth.login_failed'),
    ))
    .groupBy(auditLog.ipAddress)
    .having(sql`count(*) >= 10`);

  // Users with failed logins from multiple IPs in last hour (credential stuffing indicator)
  const multiIpFailures = await db
    .select({
      email: auditLog.actorEmail,
      ipCount: sql<number>`count(DISTINCT ${auditLog.ipAddress})`.as('ip_count'),
      attempts: countSql(),
    })
    .from(auditLog)
    .where(and(
      gte(auditLog.createdAt, oneHourAgo),
      eq(auditLog.eventType, 'auth.login_failed'),
    ))
    .groupBy(auditLog.actorEmail)
    .having(sql`count(DISTINCT ${auditLog.ipAddress}) >= 3`);

  // Rapid-fire attempts (5+ in last 5 minutes from same IP)
  const rapidFireIps = await db
    .select({
      ipAddress: auditLog.ipAddress,
      count: countSql(),
    })
    .from(auditLog)
    .where(and(
      gte(auditLog.createdAt, fiveMinAgo),
      eq(auditLog.eventType, 'auth.login_failed'),
    ))
    .groupBy(auditLog.ipAddress)
    .having(sql`count(*) >= 5`);

  // Summary counts
  const totalFailedLogins = securityEvents.find(e => e.eventType === 'auth.login_failed')?.count ?? 0;
  const totalPermissionDenied = securityEvents
    .filter(e => e.eventType?.startsWith('security.'))
    .reduce((sum, e) => sum + (e.count as number), 0);
  const total2faFailed = securityEvents.find(e => e.eventType === 'auth.2fa_failed')?.count ?? 0;
  const totalRegionBlocked = securityEvents.find(e => e.eventType === 'auth.region_blocked')?.count ?? 0;

  // Threat level calculation
  let threatLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (bruteForceIps.length > 0 || rapidFireIps.length > 0) threatLevel = 'high';
  else if (multiIpFailures.length > 0 || (totalFailedLogins as number) > 50) threatLevel = 'medium';
  if (bruteForceIps.length > 3 || rapidFireIps.length > 3) threatLevel = 'critical';

  return c.json({
    period: { hours, since: since.toISOString() },
    threatLevel,
    summary: {
      failedLogins: totalFailedLogins,
      permissionDenied: totalPermissionDenied,
      twoFaFailed: total2faFailed,
      regionBlocked: totalRegionBlocked,
      highRiskActions: highRiskEvents.length,
    },
    threats: {
      bruteForceIps,
      multiIpFailures,
      rapidFireIps,
    },
    failedLoginsByIp,
    failedLoginsByEmail: failedLoginsByEmail.filter(e => e.email),
    highRiskEvents,
    timeline,
  });
}) as any);

// ── GET /events — paginated security event log ─────────────────────

const eventsRoute = createRoute({
  method: 'get',
  path: '/events',
  tags: ['Security'],
  summary: 'Paginated list of security events',
  security: bearerSecurity,
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      type: z.string().optional().openapi({ description: 'Filter by event type (e.g. auth.login_failed)' }),
      ip: z.string().optional().openapi({ description: 'Filter by IP address' }),
      email: z.string().optional().openapi({ description: 'Filter by actor email' }),
      hours: z.string().optional().openapi({ description: 'Lookback period in hours (default 24)' }),
    }),
  },
  middleware: [requireAdminPermission('events', 'read')] as const,
  responses: {
    200: jsonContent(z.any(), 'Paginated security events'),
    ...standardErrors,
  },
});

securityRoutes.openapi(eventsRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));
  const offset = (page - 1) * limit;
  const hours = Math.min(720, Math.max(1, parseInt(query.hours ?? '24', 10)));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const allSecurityTypes = [...SECURITY_EVENT_TYPES, ...HIGH_RISK_EVENT_TYPES];

  const conditions: any[] = [
    gte(auditLog.createdAt, since),
  ];

  if (query.type) {
    const sanitized = query.type.replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(like(auditLog.eventType, `${sanitized}%`));
  } else {
    conditions.push(
      sql`${auditLog.eventType} IN (${sql.join(allSecurityTypes.map(t => sql`${t}`), sql`, `)})`
    );
  }

  if (query.ip) {
    conditions.push(eq(auditLog.ipAddress, query.ip));
  }
  if (query.email) {
    const sanitized = query.email.replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(like(auditLog.actorEmail, `%${sanitized}%`));
  }

  const whereClause = and(...conditions);

  const events = await db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: countSql() })
    .from(auditLog)
    .where(whereClause);

  return c.json({
    data: events,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
}) as any);

// ── GET /ip/:ip — investigation detail for a specific IP ──────────

const ipDetailRoute = createRoute({
  method: 'get',
  path: '/ip/{ip}',
  tags: ['Security'],
  summary: 'Investigate a specific IP address',
  security: bearerSecurity,
  request: {
    params: z.object({
      ip: z.string().openapi({ description: 'IP address to investigate' }),
    }),
    query: z.object({
      hours: z.string().optional(),
    }),
  },
  middleware: [requireAdminPermission('events', 'read')] as const,
  responses: {
    200: jsonContent(z.any(), 'IP investigation detail'),
    ...standardErrors,
  },
});

securityRoutes.openapi(ipDetailRoute, (async (c: any) => {
  const { ip } = c.req.valid('param');
  const hours = Math.min(720, Math.max(1, parseInt(c.req.valid('query').hours ?? '72', 10)));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // All events from this IP
  const events = await db
    .select()
    .from(auditLog)
    .where(and(
      eq(auditLog.ipAddress, ip),
      gte(auditLog.createdAt, since),
    ))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  // Event type breakdown
  const breakdown = await db
    .select({
      eventType: auditLog.eventType,
      count: countSql(),
    })
    .from(auditLog)
    .where(and(
      eq(auditLog.ipAddress, ip),
      gte(auditLog.createdAt, since),
    ))
    .groupBy(auditLog.eventType)
    .orderBy(sql`count(*) DESC`);

  // Unique emails targeted from this IP
  const targetedEmails = await db
    .select({
      email: auditLog.actorEmail,
      count: countSql(),
    })
    .from(auditLog)
    .where(and(
      eq(auditLog.ipAddress, ip),
      gte(auditLog.createdAt, since),
      eq(auditLog.eventType, 'auth.login_failed'),
    ))
    .groupBy(auditLog.actorEmail)
    .orderBy(sql`count(*) DESC`);

  // Successful logins from this IP (to check if it's also legitimate)
  const successfulLogins = await db
    .select({ count: countSql() })
    .from(auditLog)
    .where(and(
      eq(auditLog.ipAddress, ip),
      gte(auditLog.createdAt, since),
      eq(auditLog.eventType, 'user.login'),
    ));

  return c.json({
    ip,
    period: { hours, since: since.toISOString() },
    totalEvents: events.length,
    successfulLogins: successfulLogins[0]?.count ?? 0,
    breakdown,
    targetedEmails: targetedEmails.filter(e => e.email),
    recentEvents: events.slice(0, 100),
  });
}) as any);

export default securityRoutes;
