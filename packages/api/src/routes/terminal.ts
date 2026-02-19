import { Hono } from 'hono';
import { z } from 'zod';
import { db, services, sshAccessRules, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { dockerService } from '../services/docker.service.js';
import { sshService } from '../services/ssh.service.js';
import { logger } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';

const execRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: 'terminal-exec' });

const terminalRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

// NOTE: Do NOT use terminalRoutes.use('*', ...) here.
// The parent router also defines WebSocket upgrade routes at /terminal/:serviceId
// and /terminal/logs/:serviceId. Hono propagates sub-router use('*') middleware
// to the parent, which would intercept WebSocket upgrades (they have no Authorization
// header — auth is via query params). Apply middleware per-route instead.

// GET /info/:serviceId — get terminal connection info (pre-flight check)
terminalRoutes.get('/info/:serviceId', authMiddleware, tenantMiddleware, requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (!svc.dockerServiceId) {
    return c.json({ error: 'Service has no Docker deployment' }, 400);
  }

  // Get running tasks to find a container to connect to
  try {
    const tasks = await dockerService.getServiceTasks(svc.dockerServiceId);
    const runningTasks = tasks.filter((t) => t.status === 'running' && t.containerStatus?.containerId);

    return c.json({
      serviceId: svc.id,
      serviceName: svc.name,
      available: runningTasks.length > 0,
      containers: runningTasks.map((t) => ({
        containerId: t.containerStatus!.containerId,
        nodeId: t.nodeId,
        taskId: t.id,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get service tasks');
    return c.json({ error: 'Failed to query Docker for running containers' }, 500);
  }
});

// POST /exec/:serviceId — execute a one-shot command in a container
const execSchema = z.object({
  command: z.array(z.string().max(1000)).min(1).max(50),
});

terminalRoutes.post('/exec/:serviceId', execRateLimit, authMiddleware, tenantMiddleware, requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = execSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { command } = parsed.data;

  // Check IP allowlist
  const clientIp = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? c.req.header('X-Real-IP')
    ?? 'unknown';

  const accessRules = await db.query.sshAccessRules.findFirst({
    where: eq(sshAccessRules.serviceId, serviceId),
  });

  if (accessRules?.enabled && accessRules.allowedIps) {
    const allowed = sshService.isIpAllowed(clientIp, accessRules.allowedIps as string[]);
    if (!allowed) {
      return c.json({ error: 'Access denied: your IP is not in the allowlist' }, 403);
    }
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc || !svc.dockerServiceId) {
    return c.json({ error: 'Service not found or not deployed' }, 404);
  }

  try {
    const tasks = await dockerService.getServiceTasks(svc.dockerServiceId);
    const running = tasks.find((t) => t.status === 'running' && t.containerStatus?.containerId);

    if (!running?.containerStatus) {
      return c.json({ error: 'No running containers available' }, 400);
    }

    const containerId = running.containerStatus.containerId;
    const { stream } = await dockerService.execInContainer(containerId, command);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }

    const output = Buffer.concat(chunks).toString('utf-8');
    return c.json({ output });
  } catch (err) {
    logger.error({ err }, 'Exec failed');
    return c.json({ error: 'Command execution failed' }, 500);
  }
});

export default terminalRoutes;
