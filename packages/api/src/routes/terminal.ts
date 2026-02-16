import { Hono } from 'hono';
import { db, services, sshAccessRules, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { dockerService } from '../services/docker.service.js';
import { sshService } from '../services/ssh.service.js';

const terminalRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

terminalRoutes.use('*', authMiddleware);
terminalRoutes.use('*', tenantMiddleware);

// GET /info/:serviceId — get terminal connection info (pre-flight check)
terminalRoutes.get('/info/:serviceId', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
    console.error('Failed to get service tasks:', err);
    return c.json({ error: 'Failed to query Docker for running containers' }, 500);
  }
});

// POST /exec/:serviceId — execute a one-shot command in a container
terminalRoutes.post('/exec/:serviceId', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = (await c.req.json()) as { command: string[] };
  const { command } = body;

  if (!command || !Array.isArray(command) || command.length === 0) {
    return c.json({ error: 'command array is required' }, 400);
  }

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
      return c.json({ error: `Access denied from IP: ${clientIp}` }, 403);
    }
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
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
    const stream = await dockerService.execInContainer(containerId, command);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }

    const output = Buffer.concat(chunks).toString('utf-8');
    return c.json({ output });
  } catch (err) {
    console.error('Exec failed:', err);
    return c.json({ error: 'Command execution failed' }, 500);
  }
});

export default terminalRoutes;
