import { Hono } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { createNodeWebSocket } from '@hono/node-ws';
import { jwtVerify } from 'jose';
import { Readable } from 'node:stream';
import { db, services, deployments, eq, and, isNull, errorLog, userAccounts, supportTickets, selfHealingJobs, users as usersTable } from '@fleet/db';
import { orchestrator } from './services/orchestrator.js';
import { logger, logToErrorTable } from './services/logger.js';
import { getValkey } from './services/valkey.service.js';
import { getAppUrlSync } from './services/platform.service.js';
import { requestLogger } from './middleware/request-logger.js';
import { securityHeaders } from './middleware/security.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { auditMiddleware } from './middleware/audit.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import userRoutes, { userPublicRoutes } from './routes/users.js';
import serviceRoutes from './routes/services.js';
import deploymentRoutes from './routes/deployments.js';
import dnsRoutes from './routes/domains.js';
import nodeRoutes from './routes/nodes.js';
import billingRoutes from './routes/billing.js';
import billingAdminRoutes from './routes/billing-admin.js';
import terminalRoutes from './routes/terminal.js';
import sshRoutes from './routes/ssh.js';
import storageRoutes from './routes/storage.js';
import marketplaceRoutes from './routes/marketplace.js';
import backupRoutes from './routes/backups.js';
import emailRoutes from './routes/emails.js';
import domainPurchaseRoutes from './routes/domains-purchase.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';
import updateRoutes from './routes/updates.js';
import setupRoutes from './routes/setup.js';
import notificationRoutes from './routes/notifications.js';
import apiKeyRoutes from './routes/api-keys.js';
import domainPricingRoutes from './routes/domain-pricing.js';
import errorRoutes from './routes/errors.js';
import uploadRoutes from './routes/upload.js';
import fileRoutes from './routes/files.js';
import databaseRoutes, { databaseDownloadRoutes } from './routes/database.js';
import storageAdminRoutes from './routes/storage-admin.js';
import sharedDomainRoutes from './routes/shared-domains.js';
import resellerRoutes from './routes/reseller.js';
import jobRoutes from './routes/jobs.js';
import volumeFileRoutes from './routes/volume-files.js';
import logArchiveRoutes from './routes/log-archives.js';
import registryCredentialRoutes from './routes/registry-credentials.js';
import statusPageRoutes from './routes/status-page.js';
import adminRoleRoutes from './routes/admin-roles.js';
import supportRoutes from './routes/support.js';
import adminSupportRoutes from './routes/admin-support.js';
import adminI18nRoutes from './routes/admin-i18n.js';
import selfHealingRoutes from './routes/self-healing.js';

// Fleet API is stateless — all shared state lives in PostgreSQL + Valkey.
// To scale horizontally: run multiple instances behind a load balancer.
// Ensure CORS_ORIGIN, APP_URL, and all secrets are identical across instances.
function logValidationError(result: { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } }, c: { req: { method: string; url: string; header: (name: string) => string | undefined }; get: (key: never) => unknown }) {
  const details = result.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`);
  let userId: string | null = null;
  try {
    const user = c.get('user' as never) as { userId?: string } | undefined;
    userId = user?.userId ?? null;
  } catch { /* auth may not have run yet */ }

  db.insert(errorLog)
    .values({
      level: 'warn',
      message: `Validation failed: ${details.join('; ')}`,
      stack: null,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      statusCode: 400,
      userId,
      ip: null,
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { details },
    })
    .catch((dbErr) => logger.error({ dbErr }, 'Failed to write validation error to error_log'));

  return details;
}

export const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      const details = logValidationError(result, c);
      return c.json({ error: 'Validation failed', details }, 400);
    }
  },
});

// WebSocket support — export for use in index.ts
export const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

// Security headers
app.use('*', securityHeaders);

// CORS — uses platform URL from DB (via cache) or CORS_ORIGIN/APP_URL env vars
const explicitCorsOrigin = process.env['CORS_ORIGIN'];
if (process.env['NODE_ENV'] === 'production' && !explicitCorsOrigin && !process.env['APP_URL']) {
  throw new Error('CORS_ORIGIN or APP_URL must be set in production');
}
if (process.env['NODE_ENV'] === 'production' && explicitCorsOrigin === '*') {
  throw new Error('CORS_ORIGIN must not be wildcard (*) in production');
}
app.use('*', cors({
  origin: explicitCorsOrigin || (() => getAppUrlSync()),
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Account-Id', 'X-API-Key'],
  maxAge: 86400,
}));

// Request body size limit — larger for upload/files endpoints
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/v1/upload') || path.match(/\/api\/v1\/files\/[^/]+\/upload/) || path.match(/\/api\/v1\/database\/[^/]+\/import/)) {
    return bodyLimit({ maxSize: 500 * 1024 * 1024 })(c, next);
  }
  return bodyLimit({ maxSize: 2 * 1024 * 1024 })(c, next);
});

// Health check — BEFORE rate limiter so Swarm healthchecks are never blocked
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// Global rate limiter: 300 requests per minute per IP
// Skips internal node heartbeat requests (they share the Docker overlay IP and
// have their own per-route rate limiter)
const globalRateLimit = rateLimiter({ windowMs: 60_000, max: 300, keyPrefix: 'global' });
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.match(/\/api\/v1\/nodes\/[^/]+\/heartbeat$/)) {
    return next();
  }
  return globalRateLimit(c, next);
});

// Request logging
app.use('*', requestLogger);

// Global error handler — logs to DB for super admin error tracking
app.onError(async (err, c) => {
  // Return 400 for malformed JSON bodies instead of 500
  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return c.json({ error: 'Invalid JSON in request body' }, 400);
  }

  let ip = 'unknown';
  if (process.env['TRUST_PROXY'] === '1') {
    ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ?? 'unknown';
  } else {
    try {
      const { getConnInfo } = await import('@hono/node-server/conninfo');
      const conn = getConnInfo(c);
      ip = conn.remote.address ?? 'unknown';
    } catch { /* conninfo not available */ }
  }

  let userId: string | null = null;
  try {
    const user = c.get('user' as never) as { userId?: string } | undefined;
    userId = user?.userId ?? null;
  } catch { /* not authenticated */ }

  // Collect request headers (skip sensitive ones)
  const sensitiveHeaders = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']);
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    if (!sensitiveHeaders.has(key.toLowerCase())) {
      headers[key] = value;
    }
  });

  // Collect request body (redact sensitive fields)
  const sensitiveBodyKeys = new Set(['password', 'token', 'secret', 'apiKey', 'api_key', 'accessToken', 'access_token', 'refreshToken', 'refresh_token', 'currentPassword', 'newPassword', 'confirmPassword']);
  let body: unknown = null;
  try {
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('json')) {
      const raw = await c.req.json().catch(() => null);
      if (raw && typeof raw === 'object') {
        body = Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).map(([k, v]) =>
            sensitiveBodyKeys.has(k) ? [k, '[REDACTED]'] : [k, v],
          ),
        );
      }
    }
  } catch { /* body already consumed or not parseable */ }

  // Fire-and-forget: write to error_log table
  db.insert(errorLog)
    .values({
      level: 'error',
      message: err.message,
      stack: err.stack ?? null,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      statusCode: 500,
      userId,
      ip,
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { headers, ...(body ? { body } : {}) },
    })
    .catch((dbErr) => logger.error({ dbErr }, 'Failed to write error to error_log table'));

  logger.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled error');
  return c.json({ error: 'Internal server error' }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// ── Helper: verify JWT from WebSocket subprotocol ──
// Token is sent via WebSocket subprotocol (auth-<token>) to keep it out of server/proxy logs.
// Fallback to query param for backwards compatibility.
function extractWsToken(c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): string | undefined {
  // Prefer subprotocol: "auth-<jwt>"
  const protocols = c.req.header('sec-websocket-protocol');
  if (protocols) {
    const authProto = protocols.split(',').map(p => p.trim()).find(p => p.startsWith('auth-'));
    if (authProto) return authProto.slice(5); // strip "auth-" prefix
  }
  // Fallback to query param (deprecated)
  return c.req.query('token');
}

async function verifyWsToken(token: string) {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) throw new Error('JWT_SECRET not set');

  // Basic JWT structure validation before cryptographic verification
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const secret = new TextEncoder().encode(jwtSecret);
  const { payload, protectedHeader } = await jwtVerify(token, secret);

  // Reject tokens signed with unexpected algorithms
  if (protectedHeader.alg !== 'HS256') {
    throw new Error('Invalid token algorithm');
  }

  // Check token blocklist (revoked/logged-out tokens)
  const valkey = await getValkey();
  if (valkey) {
    const blocked = await valkey.get(`blocklist:${token}`);
    if (blocked) throw new Error('Token has been revoked');
  } else if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Service temporarily unavailable');
  }

  return payload as { userId: string; email: string; isSuper: boolean };
}

// API v1 routes
const api = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      const details = logValidationError(result, c);
      return c.json({ error: 'Validation failed', details }, 400);
    }
  },
});

// Error response logging — catches ALL error responses from sub-routers and logs
// them to the error_log table. Also normalizes raw Zod validation errors from
// sub-routers (which lack a defaultHook) into a consistent response format.
api.use('*', async (c, next) => {
  await next();

  const status = c.res.status;
  if (status < 400) return;

  try {
    const cloned = c.res.clone();
    const text = await cloned.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }

    let errorMessage = `HTTP ${status}`;
    let metadata: Record<string, unknown> = {};

    if (body && typeof body === 'object' && 'success' in body && (body as any).success === false && (body as any).error?.issues) {
      // Raw Zod validation error from sub-router — reformat and log
      const issues = (body as any).error.issues as Array<{ path: PropertyKey[]; message: string }>;
      const details = issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join('.')}: ${i.message}`);
      errorMessage = `Validation failed: ${details.join('; ')}`;
      metadata = { validationErrors: details };

      // Replace response with standard error format
      c.res = new Response(JSON.stringify({ error: 'Validation failed', details }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (body && typeof body === 'object' && 'error' in body) {
      const errorField = (body as any).error;
      errorMessage = typeof errorField === 'string' ? errorField : JSON.stringify(errorField);
      metadata = body as Record<string, unknown>;
    }

    let userId: string | null = null;
    try {
      const user = c.get('user' as never) as { userId?: string } | undefined;
      userId = user?.userId ?? null;
    } catch { /* auth may not have run yet */ }

    logToErrorTable({
      level: status >= 500 ? 'error' : 'warn',
      message: errorMessage,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      statusCode: status,
      userId,
      userAgent: c.req.header('user-agent') ?? null,
      metadata,
    });
  } catch { /* Response not readable — skip logging */ }
});

// Audit logging for mutating requests (POST/PUT/PATCH/DELETE)
api.use('*', auditMiddleware);

api.route('/auth', authRoutes);
api.route('/accounts', accountRoutes);
api.route('/users', userPublicRoutes);
api.route('/users', userRoutes);
api.route('/services', serviceRoutes);
api.route('/deployments', deploymentRoutes);
api.route('/dns', dnsRoutes);
api.route('/nodes', nodeRoutes);
api.route('/billing', billingRoutes);
api.route('/billing/admin', billingAdminRoutes);
api.route('/terminal', terminalRoutes);
api.route('/ssh', sshRoutes);
api.route('/storage', storageRoutes);
api.route('/marketplace', marketplaceRoutes);
api.route('/backups', backupRoutes);
api.route('/emails', emailRoutes);
api.route('/domains', domainPurchaseRoutes);
api.route('/settings', settingsRoutes);
api.route('/admin', adminRoutes);
api.route('/updates', updateRoutes);
api.route('/setup', setupRoutes);
api.route('/notifications', notificationRoutes);
api.route('/api-keys', apiKeyRoutes);
api.route('/domain-pricing', domainPricingRoutes);
api.route('/errors', errorRoutes);
api.route('/upload', uploadRoutes);
api.route('/files', fileRoutes);
api.route('/volume-files', volumeFileRoutes);
api.route('/database', databaseRoutes);
api.route('/dl/database', databaseDownloadRoutes); // public token-gated download (no auth middleware)
api.route('/admin/storage', storageAdminRoutes);
api.route('/admin/jobs', jobRoutes);
api.route('/shared-domains', sharedDomainRoutes);
api.route('/reseller', resellerRoutes);
api.route('/log-archives', logArchiveRoutes);
api.route('/registry-credentials', registryCredentialRoutes);
api.route('/status-page', statusPageRoutes);
api.route('/admin', adminRoleRoutes);
api.route('/support', supportRoutes);
api.route('/admin/support', adminSupportRoutes);
api.route('/admin/i18n', adminI18nRoutes);
api.route('/admin/self-healing', selfHealingRoutes);

// ── WebSocket: Live log streaming ──
api.get(
  '/terminal/logs/:serviceId',
  upgradeWebSocket((c) => {
    const serviceId = c.req.param('serviceId');
    const token = extractWsToken(c);
    const accountId = c.req.query('accountId');
    let logStream: Readable | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    return {
      async onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }) {
        try {
          // Validate query parameters
          if (!token || token.length > 4000) {
            ws.close(4001, 'Invalid token');
            return;
          }
          if (!accountId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
            ws.close(4001, 'Invalid accountId format');
            return;
          }

          const wsUser = await verifyWsToken(token);

          // Verify user has access to this account
          const membership = await db.query.userAccounts.findFirst({
            where: and(
              eq(userAccounts.userId, wsUser.userId),
              eq(userAccounts.accountId, accountId),
            ),
          });

          // Also allow super admins
          if (!membership && !wsUser.isSuper) {
            ws.close(4003, 'Access denied to this account');
            return;
          }

          const svc = await db.query.services.findFirst({
            where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
          });

          if (!svc?.dockerServiceId) {
            ws.close(4004, 'Service not found');
            return;
          }

          const raw = await orchestrator.getServiceLogs(svc.dockerServiceId, {
            tail: 200,
            follow: true,
          });

          logStream = raw instanceof Readable ? raw : Readable.from(raw as AsyncIterable<Buffer>);

          logStream.on('data', (chunk: Buffer) => {
            ws.send(chunk.toString('utf-8'));
          });

          logStream.on('end', () => {
            ws.close(1000, 'Log stream ended');
          });

          logStream.on('error', (err: Error) => {
            logger.error({ err }, 'Log stream error');
            ws.close(1011, 'Log stream error');
          });

          // Send WebSocket-level pings every 25s to prevent proxy timeouts
          const rawWs = (ws as any).raw;
          if (rawWs?.ping) {
            keepaliveTimer = setInterval(() => {
              try { rawWs.ping(); } catch { /* connection already closed */ }
            }, 25_000);
          }
        } catch (err) {
          logger.error({ err }, 'WS log auth failed');
          logToErrorTable({ level: 'warn', message: `WS log auth failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'websocket', operation: 'log-stream-auth' } });
          ws.close(4003, 'Auth failed');
        }
      },

      onClose() {
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        if (logStream) {
          logStream.destroy();
          logStream = null;
        }
      },
    };
  }),
);

// ── Per-account WS connection limiter (Valkey-backed for multi-replica) ──
const MAX_DEPLOY_STREAMS_PER_ACCOUNT = 20;
const activeDeployStreams = new Map<string, number>();

/**
 * Acquire a WS connection slot using Valkey for global counting across replicas.
 * Falls back to local-only counting if Valkey is unavailable.
 */
async function acquireWsSlot(
  prefix: string,
  accountId: string,
  max: number,
  localMap: Map<string, number>,
): Promise<boolean> {
  try {
    const valkey = await getValkey();
    if (valkey) {
      const key = `fleet:ws:${prefix}:${accountId}`;
      const count = await valkey.incr(key);
      if (count === 1) await valkey.expire(key, 7200); // 2-hour safety TTL
      if (count > max) {
        await valkey.decr(key);
        return false;
      }
      localMap.set(accountId, (localMap.get(accountId) ?? 0) + 1);
      return true;
    }
  } catch { /* Valkey error — fall through to local-only */ }
  const current = localMap.get(accountId) ?? 0;
  if (current >= max) return false;
  localMap.set(accountId, current + 1);
  return true;
}

async function releaseWsSlot(
  prefix: string,
  accountId: string | null,
  localMap: Map<string, number>,
): Promise<void> {
  if (!accountId) return;
  const count = localMap.get(accountId) ?? 0;
  if (count <= 1) localMap.delete(accountId);
  else localMap.set(accountId, count - 1);
  try {
    const valkey = await getValkey();
    if (valkey) {
      const key = `fleet:ws:${prefix}:${accountId}`;
      const newCount = await valkey.decr(key);
      if (newCount <= 0) await valkey.del(key);
    }
  } catch { /* ignore */ }
}

// ── Shared Valkey subscriber for deploy log fan-out ──
// Uses a single Redis connection for ALL deploy WS clients instead of one per client.
// At 1000 concurrent deployments × N viewers, this saves ~1000 TCP connections.
type DeployListener = (message: string) => void;
const deployChannelListeners = new Map<string, Set<DeployListener>>();
let sharedDeploySubscriber: Awaited<ReturnType<typeof getValkey>> = null;
let subscriberInitPromise: Promise<boolean> | null = null;

async function initSharedSubscriber(): Promise<boolean> {
  const valkey = await getValkey();
  if (!valkey) return false;

  sharedDeploySubscriber = valkey.duplicate();
  sharedDeploySubscriber.on('message', (channel: string, message: string) => {
    const listeners = deployChannelListeners.get(channel);
    if (!listeners) return;
    for (const listener of listeners) {
      try { listener(message); } catch { /* individual listener error */ }
    }
  });

  // Reconnect handling — re-subscribe to active channels
  sharedDeploySubscriber.on('ready', () => {
    const channels = [...deployChannelListeners.keys()];
    if (channels.length > 0) {
      sharedDeploySubscriber!.subscribe(...channels).catch((err) => {
        logger.error({ err }, 'Failed to re-subscribe deploy channels');
      });
    }
  });

  return true;
}

// Singleton pattern — prevents double-init race when concurrent WS connections arrive at startup
function ensureSharedSubscriber(): Promise<boolean> {
  if (!subscriberInitPromise) {
    subscriberInitPromise = initSharedSubscriber();
  }
  return subscriberInitPromise;
}

function addDeployListener(deploymentId: string, listener: DeployListener) {
  const channel = `deploy:${deploymentId}`;
  let listeners = deployChannelListeners.get(channel);
  const isNewChannel = !listeners || listeners.size === 0;
  if (!listeners) {
    listeners = new Set();
    deployChannelListeners.set(channel, listeners);
  }
  listeners.add(listener);

  // Only subscribe to Valkey if this is the first listener for this channel
  if (isNewChannel && sharedDeploySubscriber) {
    sharedDeploySubscriber.subscribe(channel).catch((err) => {
      logger.error({ err, deploymentId }, 'Failed to subscribe to deploy channel');
    });
  }
}

function removeDeployListener(deploymentId: string, listener: DeployListener) {
  const channel = `deploy:${deploymentId}`;
  const listeners = deployChannelListeners.get(channel);
  if (!listeners) return;
  listeners.delete(listener);

  // Unsubscribe from Valkey when no more listeners on this channel
  if (listeners.size === 0) {
    deployChannelListeners.delete(channel);
    if (sharedDeploySubscriber) {
      sharedDeploySubscriber.unsubscribe(channel).catch(() => {});
    }
  }
}

// ── WebSocket: Live deployment log streaming ──
api.get(
  '/terminal/deploy/:deploymentId',
  upgradeWebSocket((c) => {
    const deploymentId = c.req.param('deploymentId');
    const token = extractWsToken(c);
    const accountId = c.req.query('accountId');
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let activeListener: DeployListener | null = null;
    let trackedAccountId: string | null = null;

    return {
      async onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }) {
        try {
          if (!token || token.length > 4000 ||
              !accountId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId) ||
              !deploymentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deploymentId)) {
            ws.close(4003, 'Access denied');
            return;
          }

          const wsUser = await verifyWsToken(token);

          const membership = await db.query.userAccounts.findFirst({
            where: and(
              eq(userAccounts.userId, wsUser.userId),
              eq(userAccounts.accountId, accountId),
            ),
          });

          if (!membership && !wsUser.isSuper) {
            ws.close(4003, 'Access denied');
            return;
          }

          // Per-account connection limit (global across replicas via Valkey)
          const slotAcquired = await acquireWsSlot('deploy', accountId, MAX_DEPLOY_STREAMS_PER_ACCOUNT, activeDeployStreams);
          if (!slotAcquired) {
            ws.close(4003, 'Too many concurrent deploy streams');
            return;
          }
          trackedAccountId = accountId;

          // Verify deployment belongs to this account
          const deployment = await db.query.deployments.findFirst({
            where: eq(deployments.id, deploymentId),
          });

          if (!deployment) {
            ws.close(4003, 'Access denied');
            return;
          }

          // Verify the deployment's service belongs to the account
          const svc = await db.query.services.findFirst({
            where: and(eq(services.id, deployment.serviceId), eq(services.accountId, accountId)),
            columns: { id: true },
          });

          if (!svc) {
            ws.close(4003, 'Access denied');
            return;
          }

          // Send existing log as initial payload
          if (deployment.log) {
            ws.send(JSON.stringify({ type: 'init', log: deployment.log, status: deployment.status, step: deployment.progressStep }));
          }

          // If already terminal, send status and close
          if (deployment.status === 'succeeded' || deployment.status === 'failed') {
            ws.send(JSON.stringify({ type: 'status', status: deployment.status, step: deployment.progressStep }));
            ws.close(1000, 'Deployment already complete');
            return;
          }

          // Subscribe via shared subscriber (1 Redis connection for all deploy WS clients)
          const hasValkey = await ensureSharedSubscriber();
          if (hasValkey) {
            activeListener = (message: string) => {
              if (closed) return;
              try {
                const data = JSON.parse(message);
                // Backpressure: skip if WS buffer is backed up (> 64KB queued)
                const rawWs = (ws as any).raw;
                if (rawWs?.bufferedAmount > 65536) return;

                ws.send(JSON.stringify({ type: 'log', ...data }));

                if (data.status === 'succeeded' || data.status === 'failed') {
                  closed = true;
                  ws.close(1000, `Deployment ${data.status}`);
                }
              } catch {
                // Ignore malformed messages
              }
            };
            addDeployListener(deploymentId, activeListener);
          } else {
            // Fallback: poll DB every 2 seconds
            let lastLogLength = (deployment.log ?? '').length;
            pollTimer = setInterval(async () => {
              if (closed) return;
              try {
                const current = await db.query.deployments.findFirst({
                  where: eq(deployments.id, deploymentId),
                  columns: { log: true, status: true, progressStep: true },
                });
                if (!current) return;

                const newContent = (current.log ?? '').slice(lastLogLength);
                lastLogLength = (current.log ?? '').length;

                if (newContent) {
                  ws.send(JSON.stringify({ type: 'log', logLine: newContent, status: current.status, step: current.progressStep }));
                }

                if (current.status === 'succeeded' || current.status === 'failed') {
                  ws.send(JSON.stringify({ type: 'status', status: current.status, step: current.progressStep }));
                  closed = true;
                  ws.close(1000, `Deployment ${current.status}`);
                }
              } catch (err) {
                logger.error({ err }, 'Deploy WS poll error');
                logToErrorTable({ level: 'error', message: `Deploy WS poll error: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'websocket', operation: 'deploy-poll' } });
              }
            }, 2000);

            // Safety timeout: close poll after 30 minutes to prevent indefinite polling
            pollTimeoutTimer = setTimeout(() => {
              if (!closed) {
                closed = true;
                ws.close(1000, 'Poll timeout');
              }
            }, 30 * 60 * 1000);
          }

          // Keepalive pings
          const rawWs = (ws as any).raw;
          if (rawWs?.ping) {
            keepaliveTimer = setInterval(() => {
              try { rawWs.ping(); } catch { /* closed */ }
            }, 25_000);
          }
        } catch (err) {
          logger.error({ err }, 'WS deploy auth failed');
          logToErrorTable({ level: 'warn', message: `WS deploy auth failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'websocket', operation: 'deploy-auth' } });
          ws.close(4003, 'Auth failed');
        }
      },

      onClose() {
        closed = true;
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (pollTimeoutTimer) {
          clearTimeout(pollTimeoutTimer);
          pollTimeoutTimer = null;
        }
        if (activeListener) {
          removeDeployListener(deploymentId, activeListener);
          activeListener = null;
        }
        // Decrement per-account stream counter (global via Valkey)
        if (trackedAccountId) {
          releaseWsSlot('deploy', trackedAccountId, activeDeployStreams);
          trackedAccountId = null;
        }
      },
    };
  }),
);

// ── WebSocket: Support ticket real-time chat ──
// Shared Valkey subscriber for support ticket fan-out (one Redis connection for all support WS clients)
type SupportListener = (message: string) => void;
const supportChannelListeners = new Map<string, Set<SupportListener>>();
let sharedSupportSubscriber: Awaited<ReturnType<typeof getValkey>> = null;
let supportSubscriberInitPromise: Promise<boolean> | null = null;

async function initSharedSupportSubscriber(): Promise<boolean> {
  const valkey = await getValkey();
  if (!valkey) return false;

  sharedSupportSubscriber = valkey.duplicate();
  sharedSupportSubscriber.on('message', (channel: string, message: string) => {
    const listeners = supportChannelListeners.get(channel);
    if (!listeners) return;
    for (const listener of listeners) {
      try { listener(message); } catch { /* individual listener error */ }
    }
  });

  sharedSupportSubscriber.on('ready', () => {
    const channels = [...supportChannelListeners.keys()];
    if (channels.length > 0) {
      sharedSupportSubscriber!.subscribe(...channels).catch((err) => {
        logger.error({ err }, 'Failed to re-subscribe support channels');
      });
    }
  });

  return true;
}

function ensureSharedSupportSubscriber(): Promise<boolean> {
  if (!supportSubscriberInitPromise) {
    supportSubscriberInitPromise = initSharedSupportSubscriber();
  }
  return supportSubscriberInitPromise;
}

function addSupportListener(ticketId: string, listener: SupportListener) {
  const channel = `support:ticket:${ticketId}`;
  let listeners = supportChannelListeners.get(channel);
  const isNewChannel = !listeners || listeners.size === 0;
  if (!listeners) {
    listeners = new Set();
    supportChannelListeners.set(channel, listeners);
  }
  listeners.add(listener);

  if (isNewChannel && sharedSupportSubscriber) {
    sharedSupportSubscriber.subscribe(channel).catch((err) => {
      logger.error({ err, ticketId }, 'Failed to subscribe to support channel');
    });
  }
}

function removeSupportListener(ticketId: string, listener: SupportListener) {
  const channel = `support:ticket:${ticketId}`;
  const listeners = supportChannelListeners.get(channel);
  if (!listeners) return;
  listeners.delete(listener);

  if (listeners.size === 0) {
    supportChannelListeners.delete(channel);
    if (sharedSupportSubscriber) {
      sharedSupportSubscriber.unsubscribe(channel).catch(() => {});
    }
  }
}

api.get(
  '/support/tickets/:ticketId/ws',
  upgradeWebSocket((c) => {
    const ticketId = c.req.param('ticketId');
    const token = extractWsToken(c);
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let activeListener: SupportListener | null = null;
    let isAdminUser = false;

    return {
      async onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }) {
        try {
          if (!token || token.length > 4000) {
            ws.close(4001, 'Invalid token');
            return;
          }
          if (!ticketId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) {
            ws.close(4001, 'Invalid ticketId');
            return;
          }

          const wsUser = await verifyWsToken(token);
          isAdminUser = wsUser.isSuper;

          // Verify the user has access to this ticket
          const ticket = await db.query.supportTickets.findFirst({
            where: eq(supportTickets.id, ticketId),
          });

          if (!ticket) {
            ws.close(4004, 'Ticket not found');
            return;
          }

          // Check if user is an admin (super or has admin role)
          if (!isAdminUser) {
            const wsUserRecord = await db.query.users.findFirst({
              where: eq(usersTable.id, wsUser.userId),
              columns: { adminRoleId: true },
            });
            if (wsUserRecord?.adminRoleId) {
              isAdminUser = true;
            }
          }

          // Non-admin users: verify they belong to the ticket's account
          if (!isAdminUser) {
            const membership = await db.query.userAccounts.findFirst({
              where: and(
                eq(userAccounts.userId, wsUser.userId),
                eq(userAccounts.accountId, ticket.accountId),
              ),
            });
            if (!membership) {
              ws.close(4003, 'Access denied');
              return;
            }
          }

          // Subscribe to Valkey channel for this ticket
          const hasValkey = await ensureSharedSupportSubscriber();
          if (hasValkey) {
            activeListener = (message: string) => {
              try {
                const data = JSON.parse(message);
                // Filter out internal notes for non-admin clients
                if (!isAdminUser && data.type === 'message' && data.message?.isInternal) {
                  return;
                }
                ws.send(message);
              } catch { /* ignore malformed */ }
            };
            addSupportListener(ticketId, activeListener);
          }

          // Keepalive pings
          const rawWs = (ws as any).raw;
          if (rawWs?.ping) {
            keepaliveTimer = setInterval(() => {
              try { rawWs.ping(); } catch { /* closed */ }
            }, 25_000);
          }
        } catch (err) {
          logger.error({ err }, 'WS support auth failed');
          logToErrorTable({ level: 'warn', message: `WS support auth failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'websocket', operation: 'support-auth' } });
          ws.close(4003, 'Auth failed');
        }
      },

      onClose() {
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        if (activeListener) {
          removeSupportListener(ticketId, activeListener);
          activeListener = null;
        }
      },
    };
  }),
);

// ── WebSocket: Interactive terminal (PTY) ──
// Per-account concurrent terminal session limiter
const MAX_TERMINAL_SESSIONS_PER_ACCOUNT = 10;
const activeTerminalSessions = new Map<string, number>();

api.get(
  '/terminal/:serviceId',
  upgradeWebSocket((c) => {
    const serviceId = c.req.param('serviceId');
    const token = extractWsToken(c);
    const accountId = c.req.query('accountId');
    const requestedContainerId = c.req.query('containerId');
    let dockerStream: import('node:stream').Duplex | null = null;
    let execId: string | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let sessionAccountId: string | null = null;

    return {
      async onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }) {
        try {
          // Validate query parameters
          if (!token || token.length > 4000) {
            ws.close(4001, 'Invalid token');
            return;
          }
          if (!accountId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
            ws.close(4001, 'Invalid accountId format');
            return;
          }

          const wsUser = await verifyWsToken(token);

          // Verify user has access to this account
          const membership = await db.query.userAccounts.findFirst({
            where: and(
              eq(userAccounts.userId, wsUser.userId),
              eq(userAccounts.accountId, accountId),
            ),
          });

          // Also allow super admins
          if (!membership && !wsUser.isSuper) {
            ws.close(4003, 'Access denied to this account');
            return;
          }

          // Enforce per-account concurrent terminal session limit (global via Valkey)
          const termSlotAcquired = await acquireWsSlot('terminal', accountId, MAX_TERMINAL_SESSIONS_PER_ACCOUNT, activeTerminalSessions);
          if (!termSlotAcquired) {
            ws.close(4029, `Too many terminal sessions (max ${MAX_TERMINAL_SESSIONS_PER_ACCOUNT})`);
            return;
          }
          sessionAccountId = accountId;

          const svc = await db.query.services.findFirst({
            where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
          });

          if (!svc?.dockerServiceId) {
            ws.close(4004, 'Service not found');
            return;
          }

          const tasks = await orchestrator.getServiceTasks(svc.dockerServiceId);
          const runningTasks = tasks.filter(
            (t) => t.status === 'running' && t.containerStatus?.containerId,
          );

          // Use requested container if specified, otherwise first running task
          let targetTask = requestedContainerId
            ? runningTasks.find((t) => t.containerStatus!.containerId === requestedContainerId)
            : undefined;
          if (!targetTask) {
            targetTask = runningTasks[0];
          }

          if (!targetTask?.containerStatus?.containerId) {
            ws.close(4004, 'No running containers');
            return;
          }

          const targetContainer = targetTask.containerStatus.containerId;
          const targetNodeId = targetTask.nodeId;

          // Check if container is on this node or a remote node
          const localNodeId = await orchestrator.getLocalNodeId();
          const isLocal = targetNodeId === localNodeId;

          if (!isLocal) {
            // ── Remote node: proxy through Fleet agent WebSocket ──
            const agentUrl = await orchestrator.getAgentAddress(targetNodeId);
            if (!agentUrl) {
              ws.close(4004, 'No agent on target node');
              return;
            }

            const token = process.env['NODE_AUTH_TOKEN'] || '';
            const agentWsUrl = agentUrl.replace('http://', 'ws://');
            const proxyUrl = `${agentWsUrl}/ws/exec?token=${encodeURIComponent(token)}&containerId=${encodeURIComponent(targetContainer)}`;

            const { default: WebSocket } = await import('ws');
            const agentWs = new WebSocket(proxyUrl);

            agentWs.on('open', () => {
              logger.info({ targetContainer, targetNodeId }, 'Agent terminal proxy connected');
            });

            // Agent → Client: raw terminal output
            agentWs.on('message', (data: Buffer | string) => {
              ws.send(typeof data === 'string' ? data : data.toString('utf-8'));
            });

            agentWs.on('close', () => {
              ws.close(1000, 'Agent disconnected');
            });

            agentWs.on('error', (err: Error) => {
              logger.error({ err, targetNodeId }, 'Agent WebSocket proxy error');
              ws.close(1011, 'Agent connection failed');
            });

            // Store proxy reference for onMessage/onClose handlers
            dockerStream = {
              write: (data: any) => {
                if (agentWs.readyState === WebSocket.OPEN) {
                  agentWs.send(data);
                }
              },
              destroy: () => {
                agentWs.close();
              },
            } as any;

            // For resize, forward JSON message to agent
            execId = '__proxy__';

            // Send WebSocket-level pings every 25s to prevent proxy timeouts
            const rawWs = (ws as any).raw;
            if (rawWs?.ping) {
              keepaliveTimer = setInterval(() => {
                try { rawWs.ping(); } catch { /* connection already closed */ }
              }, 25_000);
            }
          } else {
            // ── Local node: direct exec into container ──

            // Try multiple shells — some images only have bash or ash
            let result: { stream: NodeJS.ReadWriteStream; execId: string } | null = null;
            for (const shell of ['/bin/sh', '/bin/bash', '/bin/ash']) {
              try {
                result = await orchestrator.execInContainer(targetContainer, [shell]);
                break;
              } catch {
                // Try next shell
              }
            }
            if (!result) {
              ws.close(4004, 'No shell available in container');
              return;
            }
            dockerStream = result.stream as import('node:stream').Duplex;
            execId = result.execId;

            dockerStream.on('data', (chunk: Buffer) => {
              ws.send(chunk.toString('utf-8'));
            });

            dockerStream.on('end', () => {
              ws.close(1000, 'Container stream ended');
            });

            dockerStream.on('error', (err: Error) => {
              logger.error({ err }, 'Docker stream error');
              ws.close(1011, 'Container error');
            });

            // Send WebSocket-level pings every 25s to prevent proxy timeouts
            const rawWs = (ws as any).raw;
            if (rawWs?.ping) {
              keepaliveTimer = setInterval(() => {
                try { rawWs.ping(); } catch { /* connection already closed */ }
              }, 25_000);
            }
          }
        } catch (err) {
          logger.error({ err }, 'WS terminal auth failed');
          logToErrorTable({ level: 'warn', message: `WS terminal auth failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'websocket', operation: 'terminal-auth' } });
          ws.close(4003, 'Auth failed');
        }
      },

      async onMessage(evt: { data: unknown }, _ws: unknown) {
        if (!dockerStream) return;
        try {
          const msg = JSON.parse(
            typeof evt.data === 'string' ? evt.data : evt.data?.toString?.() ?? '',
          ) as { type: string; data?: string; cols?: number; rows?: number };

          if (msg.type === 'input' && msg.data) {
            dockerStream.write(msg.data);
          } else if (msg.type === 'resize' && msg.cols && msg.rows && execId) {
            if (execId === '__proxy__') {
              // Forward resize to agent WebSocket as JSON
              dockerStream.write(JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows }));
            } else {
              await orchestrator.resizeExec(execId, msg.rows, msg.cols);
            }
          }
        } catch {
          // Ignore invalid messages
        }
      },

      onClose() {
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        if (dockerStream) {
          dockerStream.destroy();
          dockerStream = null;
        }
        execId = null;
        // Release terminal session slot (global via Valkey)
        if (sessionAccountId) {
          releaseWsSlot('terminal', sessionAccountId, activeTerminalSessions);
          sessionAccountId = null;
        }
      },
    };
  }),
);

// ── WebSocket: Self-healing container terminal ──
api.get(
  '/terminal/self-healing/:jobId',
  upgradeWebSocket((c) => {
    const jobId = c.req.param('jobId');
    const token = extractWsToken(c);
    let dockerStream: import('node:stream').Duplex | null = null;
    let execId: string | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    return {
      async onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }) {
        try {
          if (!token || token.length > 4000) {
            ws.close(4001, 'Invalid token');
            return;
          }

          const wsUser = await verifyWsToken(token);

          // Only super admins can access self-healing terminals
          if (!wsUser.isSuper) {
            ws.close(4003, 'Super admin access required');
            return;
          }

          // Look up the job to find the Docker service
          const job = await db.query.selfHealingJobs.findFirst({
            where: eq(selfHealingJobs.id, jobId),
          });

          if (!job?.dockerServiceId) {
            ws.close(4004, 'Job not found or no container');
            return;
          }

          // Find the running container
          const tasks = await orchestrator.getServiceTasks(job.dockerServiceId);
          const runningTask = tasks.find(
            (t) => t.status === 'running' && t.containerStatus?.containerId,
          );

          if (!runningTask?.containerStatus?.containerId) {
            ws.close(4004, 'No running containers for this job');
            return;
          }

          const targetContainer = runningTask.containerStatus.containerId;
          const targetNodeId = runningTask.nodeId;
          const localNodeId = await orchestrator.getLocalNodeId();
          const isLocal = targetNodeId === localNodeId;

          if (!isLocal) {
            const agentUrl = await orchestrator.getAgentAddress(targetNodeId);
            if (!agentUrl) {
              ws.close(4004, 'No agent on target node');
              return;
            }

            const nodeToken = process.env['NODE_AUTH_TOKEN'] || '';
            const agentWsUrl = agentUrl.replace('http://', 'ws://');
            const proxyUrl = `${agentWsUrl}/ws/exec?token=${encodeURIComponent(nodeToken)}&containerId=${encodeURIComponent(targetContainer)}`;

            const { default: WebSocket } = await import('ws');
            const agentWs = new WebSocket(proxyUrl);

            agentWs.on('message', (data: Buffer | string) => {
              ws.send(typeof data === 'string' ? data : data.toString('utf-8'));
            });
            agentWs.on('close', () => ws.close(1000, 'Agent disconnected'));
            agentWs.on('error', () => ws.close(1011, 'Agent connection failed'));

            dockerStream = {
              write: (data: any) => { if (agentWs.readyState === WebSocket.OPEN) agentWs.send(data); },
              destroy: () => { agentWs.close(); },
            } as any;
            execId = '__proxy__';
          } else {
            let result: { stream: NodeJS.ReadWriteStream; execId: string } | null = null;
            for (const shell of ['/bin/bash', '/bin/sh', '/bin/ash']) {
              try {
                result = await orchestrator.execInContainer(targetContainer, [shell]);
                break;
              } catch { /* try next */ }
            }
            if (!result) {
              ws.close(4004, 'No shell available in container');
              return;
            }
            dockerStream = result.stream as import('node:stream').Duplex;
            execId = result.execId;

            dockerStream.on('data', (chunk: Buffer) => ws.send(chunk.toString('utf-8')));
            dockerStream.on('end', () => ws.close(1000, 'Container stream ended'));
            dockerStream.on('error', () => ws.close(1011, 'Container error'));
          }

          const rawWs = (ws as any).raw;
          if (rawWs?.ping) {
            keepaliveTimer = setInterval(() => {
              try { rawWs.ping(); } catch { /* closed */ }
            }, 25_000);
          }
        } catch (err) {
          logger.error({ err }, 'WS self-healing terminal auth failed');
          ws.close(4003, 'Auth failed');
        }
      },

      async onMessage(evt: { data: unknown }, _ws: unknown) {
        if (!dockerStream) return;
        try {
          const msg = JSON.parse(
            typeof evt.data === 'string' ? evt.data : evt.data?.toString?.() ?? '',
          ) as { type: string; data?: string; cols?: number; rows?: number };

          if (msg.type === 'input' && msg.data) {
            dockerStream.write(msg.data);
          } else if (msg.type === 'resize' && msg.cols && msg.rows && execId) {
            if (execId === '__proxy__') {
              dockerStream.write(JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows }));
            } else {
              await orchestrator.resizeExec(execId, msg.rows, msg.cols);
            }
          }
        } catch { /* ignore */ }
      },

      onClose() {
        if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
        if (dockerStream) { dockerStream.destroy(); dockerStream = null; }
        execId = null;
      },
    };
  }),
);

// ── WebSocket: Admin container terminal (any container, super admin only) ──
api.get(
  '/terminal/admin/:containerId',
  upgradeWebSocket((c) => {
    const containerId = c.req.param('containerId');
    const nodeId = c.req.query('nodeId') ?? '';
    const token = extractWsToken(c);
    let dockerStream: import('node:stream').Duplex | null = null;
    let execId: string | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    return {
      async onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }) {
        try {
          if (!token || token.length > 4000) {
            ws.close(4001, 'Invalid token');
            return;
          }

          const wsUser = await verifyWsToken(token);

          if (!wsUser.isSuper) {
            ws.close(4003, 'Super admin access required');
            return;
          }

          if (!containerId || !nodeId) {
            ws.close(4004, 'containerId and nodeId are required');
            return;
          }

          const localNodeId = await orchestrator.getLocalNodeId();
          const isLocal = nodeId === localNodeId;

          if (!isLocal) {
            const agentUrl = await orchestrator.getAgentAddress(nodeId);
            if (!agentUrl) {
              ws.close(4004, 'No agent on target node');
              return;
            }

            const nodeToken = process.env['NODE_AUTH_TOKEN'] || '';
            const agentWsUrl = agentUrl.replace('http://', 'ws://');
            const proxyUrl = `${agentWsUrl}/ws/exec?token=${encodeURIComponent(nodeToken)}&containerId=${encodeURIComponent(containerId)}`;

            const { default: WebSocket } = await import('ws');
            const agentWs = new WebSocket(proxyUrl);

            agentWs.on('message', (data: Buffer | string) => {
              ws.send(typeof data === 'string' ? data : data.toString('utf-8'));
            });
            agentWs.on('close', () => ws.close(1000, 'Agent disconnected'));
            agentWs.on('error', () => ws.close(1011, 'Agent connection failed'));

            dockerStream = {
              write: (data: any) => { if (agentWs.readyState === WebSocket.OPEN) agentWs.send(data); },
              destroy: () => { agentWs.close(); },
            } as any;
            execId = '__proxy__';
          } else {
            let result: { stream: NodeJS.ReadWriteStream; execId: string } | null = null;
            for (const shell of ['/bin/sh', '/bin/bash', '/bin/ash']) {
              try {
                result = await orchestrator.execInContainer(containerId, [shell]);
                break;
              } catch { /* try next */ }
            }
            if (!result) {
              ws.close(4004, 'No shell available in container');
              return;
            }
            dockerStream = result.stream as import('node:stream').Duplex;
            execId = result.execId;

            dockerStream.on('data', (chunk: Buffer) => ws.send(chunk.toString('utf-8')));
            dockerStream.on('end', () => ws.close(1000, 'Container stream ended'));
            dockerStream.on('error', () => ws.close(1011, 'Container error'));
          }

          const rawWs = (ws as any).raw;
          if (rawWs?.ping) {
            keepaliveTimer = setInterval(() => {
              try { rawWs.ping(); } catch { /* closed */ }
            }, 25_000);
          }
        } catch (err) {
          logger.error({ err }, 'WS admin terminal auth failed');
          ws.close(4003, 'Auth failed');
        }
      },

      async onMessage(evt: { data: unknown }, _ws: unknown) {
        if (!dockerStream) return;
        try {
          const msg = JSON.parse(
            typeof evt.data === 'string' ? evt.data : evt.data?.toString?.() ?? '',
          ) as { type: string; data?: string; cols?: number; rows?: number };

          if (msg.type === 'input' && msg.data) {
            dockerStream.write(msg.data);
          } else if (msg.type === 'resize' && msg.cols && msg.rows && execId) {
            if (execId === '__proxy__') {
              dockerStream.write(JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows }));
            } else {
              await orchestrator.resizeExec(execId, msg.rows, msg.cols);
            }
          }
        } catch { /* ignore */ }
      },

      onClose() {
        if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
        if (dockerStream) { dockerStream.destroy(); dockerStream = null; }
        execId = null;
      },
    };
  }),
);

// ── Public branding endpoints (no auth) ──
const brandingRateLimit = rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'branding' });

app.get('/api/v1/branding/info', brandingRateLimit, async (c) => {
  const { db: dbImport, platformSettings, eq: eqOp } = await import('@fleet/db');

  const rows = await dbImport.query.platformSettings.findMany({
    where: (s, { like }) => like(s.key, 'branding:%'),
  });

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  const logoFilename = settings['branding:logoFilename'] as string | undefined;
  const faviconFilename = settings['branding:faviconFilename'] as string | undefined;
  const title = settings['branding:title'] as string | undefined;
  const githubUrl = settings['branding:githubUrl'] as string | undefined;

  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    title: title ?? null,
    logoUrl: logoFilename ? '/api/v1/branding/logo' : null,
    faviconUrl: faviconFilename ? '/api/v1/branding/favicon' : null,
    githubUrl: githubUrl ?? null,
  });
});

app.get('/api/v1/branding/:type', brandingRateLimit, async (c) => {
  const type = c.req.param('type');
  if (type !== 'logo' && type !== 'favicon') {
    return c.json({ error: 'Invalid type' }, 400);
  }

  const { db: dbImport, platformSettings, eq: eqOp } = await import('@fleet/db');
  const settingKey = type === 'logo' ? 'branding:logoFilename' : 'branding:faviconFilename';

  const row = await dbImport.query.platformSettings.findFirst({
    where: eqOp(platformSettings.key, settingKey),
  });

  if (!row?.value) {
    return c.json({ error: 'Not configured' }, 404);
  }

  const filename = row.value as string;
  const { join } = await import('node:path');
  const { readFile, stat } = await import('node:fs/promises');

  const UPLOAD_BASE = process.env['UPLOAD_BASE_PATH']
    ?? (process.env['NODE_ENV'] === 'production' ? '/srv/nfs/uploads' : join(process.cwd(), 'data', 'uploads'));
  const filePath = join(UPLOAD_BASE, 'platform', 'branding', filename);

  try {
    await stat(filePath);
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }

  const data = await readFile(filePath);
  const ext = filename.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
  };

  return new Response(data, {
    headers: {
      'Content-Type': contentTypes[ext ?? ''] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// ── Public i18n overrides endpoint (no auth, needed before login) ──
const i18nRateLimit = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'i18n-public' });

app.get('/api/v1/i18n/overrides', i18nRateLimit, async (c) => {
  const { db: dbImport, platformSettings, eq: eqOp } = await import('@fleet/db');

  // Fetch custom locales
  const customLocalesRow = await dbImport.query.platformSettings.findFirst({
    where: eqOp(platformSettings.key, 'i18n:custom_locales'),
  });
  const customLocales = (customLocalesRow?.value as { code: string; name: string }[] | null) ?? [];

  // Fetch all override entries
  const allRows = await dbImport.query.platformSettings.findMany();
  const overrides: Record<string, Record<string, string>> = {};
  for (const row of allRows) {
    if (row.key.startsWith('i18n:overrides:')) {
      const locale = row.key.replace('i18n:overrides:', '');
      overrides[locale] = (row.value as Record<string, string>) ?? {};
    }
  }

  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ customLocales, overrides });
});

app.route('/api/v1', api);

// ── OpenAPI Spec + Scalar API Docs ──
// Generates the spec from all routes registered with .openapi() on OpenAPIHono instances.
// Routes using plain .get()/.post() still work but won't appear in the spec until converted.
app.doc('/api/docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Fleet API',
    version: process.env['FLEET_VERSION'] ?? '0.1.0',
    description: 'Fleet PaaS platform API — deploy, manage, and scale containerized applications on Docker Swarm.',
  },
  servers: [
    { url: process.env['APP_URL'] ?? 'http://localhost:3000', description: 'Fleet API Server' },
  ],
  security: [{ bearerAuth: [] }],
});

// Register security schemes
app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT access token obtained from POST /api/v1/auth/login or /api/v1/auth/register',
});
app.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
  description: 'API key created via POST /api/v1/api-keys',
});

// Scalar API Reference UI (three-column layout)
const docsRateLimit = rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'docs' });
app.get('/api/docs', docsRateLimit, apiReference({
  theme: 'kepler',
  url: '/api/docs/openapi.json',
  metaData: { title: 'Fleet API Reference' },
}));

export type AppType = typeof app;
