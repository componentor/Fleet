import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { jwtVerify } from 'jose';
import { Readable } from 'node:stream';
import { db, services, eq, and } from '@fleet/db';
import { dockerService } from './services/docker.service.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import userRoutes from './routes/users.js';
import serviceRoutes from './routes/services.js';
import deploymentRoutes from './routes/deployments.js';
import dnsRoutes from './routes/domains.js';
import nodeRoutes from './routes/nodes.js';
import billingRoutes from './routes/billing.js';
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

export const app = new Hono();

// WebSocket support — export for use in index.ts
export const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Helper: verify JWT from WebSocket query param ──
async function verifyWsToken(token: string) {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) throw new Error('JWT_SECRET not set');
  const secret = new TextEncoder().encode(jwtSecret);
  const { payload } = await jwtVerify(token, secret);
  return payload as { userId: string; email: string; isSuper: boolean };
}

// API v1 routes
const api = new Hono();

api.route('/auth', authRoutes);
api.route('/accounts', accountRoutes);
api.route('/users', userRoutes);
api.route('/services', serviceRoutes);
api.route('/deployments', deploymentRoutes);
api.route('/dns', dnsRoutes);
api.route('/nodes', nodeRoutes);
api.route('/billing', billingRoutes);
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

// ── WebSocket: Live log streaming ──
api.get(
  '/terminal/logs/:serviceId',
  upgradeWebSocket((c) => {
    const serviceId = c.req.param('serviceId');
    const token = c.req.query('token');
    const accountId = c.req.query('accountId');
    let logStream: Readable | null = null;

    return {
      async onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }) {
        try {
          if (!token || !accountId) {
            ws.close(4001, 'Missing token or accountId');
            return;
          }

          await verifyWsToken(token);

          const svc = await db.query.services.findFirst({
            where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
            console.error('Log stream error:', err);
            ws.close(1011, 'Log stream error');
          });
        } catch (err) {
          console.error('WS log auth failed:', err);
          ws.close(4003, 'Auth failed');
        }
      },

      onClose() {
        if (logStream) {
          logStream.destroy();
          logStream = null;
        }
      },
    };
  }),
);

// ── WebSocket: Interactive terminal (PTY) ──
api.get(
  '/terminal/:serviceId',
  upgradeWebSocket((c) => {
    const serviceId = c.req.param('serviceId');
    const token = c.req.query('token');
    const accountId = c.req.query('accountId');
    let dockerStream: import('node:stream').Duplex | null = null;
    let execId: string | null = null;

    return {
      async onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }) {
        try {
          if (!token || !accountId) {
            ws.close(4001, 'Missing token or accountId');
            return;
          }

          await verifyWsToken(token);

          const svc = await db.query.services.findFirst({
            where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
          });

          if (!svc?.dockerServiceId) {
            ws.close(4004, 'Service not found');
            return;
          }

          const tasks = await dockerService.getServiceTasks(svc.dockerServiceId);
          const running = tasks.find(
            (t) => t.status === 'running' && t.containerStatus?.containerId,
          );

          if (!running?.containerStatus) {
            ws.close(4004, 'No running containers');
            return;
          }

          const result = await dockerService.execInContainer(
            running.containerStatus.containerId,
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
            console.error('Docker stream error:', err);
            ws.close(1011, 'Container error');
          });
        } catch (err) {
          console.error('WS terminal auth failed:', err);
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
        if (dockerStream) {
          dockerStream.destroy();
          dockerStream = null;
        }
        execId = null;
      },
    };
  }),
);

app.route('/api/v1', api);

export type AppType = typeof app;
