import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { createNodeWebSocket } from '@hono/node-ws';
import { jwtVerify } from 'jose';
import { Readable } from 'node:stream';
import { db, services, deployments, eq, and, isNull, errorLog, userAccounts } from '@fleet/db';
import { dockerService } from './services/docker.service.js';
import { logger } from './services/logger.js';
import { getValkey } from './services/valkey.service.js';
import { requestLogger } from './middleware/request-logger.js';
import { securityHeaders } from './middleware/security.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { auditMiddleware } from './middleware/audit.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import userRoutes from './routes/users.js';
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

// Fleet API is stateless — all shared state lives in PostgreSQL + Valkey.
// To scale horizontally: run multiple instances behind a load balancer.
// Ensure CORS_ORIGIN, APP_URL, and all secrets are identical across instances.
export const app = new Hono();

// WebSocket support — export for use in index.ts
export const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

// Security headers
app.use('*', securityHeaders);

// CORS — in production, CORS_ORIGIN or APP_URL must be explicitly set
const corsOrigin = process.env['CORS_ORIGIN'] || process.env['APP_URL'];
if (process.env['NODE_ENV'] === 'production' && !corsOrigin) {
  throw new Error('CORS_ORIGIN or APP_URL must be set in production');
}
if (process.env['NODE_ENV'] === 'production' && corsOrigin === '*') {
  throw new Error('CORS_ORIGIN must not be wildcard (*) in production');
}
app.use('*', cors({
  origin: corsOrigin || '*',
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

// Global rate limiter: 120 requests per minute per IP
app.use('*', rateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'global' }));

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
    })
    .catch((dbErr) => logger.error({ dbErr }, 'Failed to write error to error_log table'));

  logger.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled error');
  return c.json({ error: 'Internal server error' }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Health check (enhanced with uptime)
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// ── Helper: verify JWT from WebSocket query param ──
// NOTE: WebSocket connections require token in query params due to browser WS API limitations.
// Tokens are short-lived (15m access tokens) to mitigate query param logging risks.
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
const api = new Hono();

// Audit logging for mutating requests (POST/PUT/PATCH/DELETE)
api.use('*', auditMiddleware);

api.route('/auth', authRoutes);
api.route('/accounts', accountRoutes);
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
api.route('/database', databaseRoutes);
api.route('/dl/database', databaseDownloadRoutes); // public token-gated download (no auth middleware)
api.route('/admin/storage', storageAdminRoutes);

// ── WebSocket: Live log streaming ──
api.get(
  '/terminal/logs/:serviceId',
  upgradeWebSocket((c) => {
    const serviceId = c.req.param('serviceId');
    const token = c.req.query('token');
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

          const raw = await dockerService.getServiceLogs(svc.dockerServiceId, {
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

// ── Per-account deploy WS connection limiter ──
const MAX_DEPLOY_STREAMS_PER_ACCOUNT = 20;
const activeDeployStreams = new Map<string, number>();

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
    const token = c.req.query('token');
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

          // Per-account connection limit
          const currentStreams = activeDeployStreams.get(accountId) ?? 0;
          if (currentStreams >= MAX_DEPLOY_STREAMS_PER_ACCOUNT) {
            ws.close(4003, 'Too many concurrent deploy streams');
            return;
          }
          activeDeployStreams.set(accountId, currentStreams + 1);
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
        // Decrement per-account stream counter
        if (trackedAccountId) {
          const count = activeDeployStreams.get(trackedAccountId) ?? 0;
          if (count <= 1) {
            activeDeployStreams.delete(trackedAccountId);
          } else {
            activeDeployStreams.set(trackedAccountId, count - 1);
          }
          trackedAccountId = null;
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
    const token = c.req.query('token');
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

          // Enforce per-account concurrent terminal session limit
          const currentSessions = activeTerminalSessions.get(accountId) ?? 0;
          if (currentSessions >= MAX_TERMINAL_SESSIONS_PER_ACCOUNT) {
            ws.close(4029, `Too many terminal sessions (max ${MAX_TERMINAL_SESSIONS_PER_ACCOUNT})`);
            return;
          }
          activeTerminalSessions.set(accountId, currentSessions + 1);
          sessionAccountId = accountId;

          const svc = await db.query.services.findFirst({
            where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
          });

          if (!svc?.dockerServiceId) {
            ws.close(4004, 'Service not found');
            return;
          }

          const tasks = await dockerService.getServiceTasks(svc.dockerServiceId);
          const runningTasks = tasks.filter(
            (t) => t.status === 'running' && t.containerStatus?.containerId,
          );

          // Use requested container if specified, otherwise first running task
          let targetContainer: string | undefined;
          if (requestedContainerId) {
            const match = runningTasks.find((t) => t.containerStatus!.containerId === requestedContainerId);
            targetContainer = match?.containerStatus?.containerId;
          }
          if (!targetContainer) {
            targetContainer = runningTasks[0]?.containerStatus?.containerId;
          }

          if (!targetContainer) {
            ws.close(4004, 'No running containers');
            return;
          }

          const result = await dockerService.execInContainer(
            targetContainer,
            ['/bin/sh'],
          );
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
        } catch (err) {
          logger.error({ err }, 'WS terminal auth failed');
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
            await dockerService.resizeExec(execId, msg.rows, msg.cols);
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
        // Release terminal session slot
        if (sessionAccountId) {
          const count = activeTerminalSessions.get(sessionAccountId) ?? 1;
          if (count <= 1) activeTerminalSessions.delete(sessionAccountId);
          else activeTerminalSessions.set(sessionAccountId, count - 1);
          sessionAccountId = null;
        }
      },
    };
  }),
);

app.route('/api/v1', api);

export type AppType = typeof app;
