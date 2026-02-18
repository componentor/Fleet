import { Hono } from 'hono';
import { z } from 'zod';
import { db, nodes, nodeMetrics, insertReturning, updateReturning, eq, and, gte } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { dockerService } from '../services/docker.service.js';
import { logger } from '../services/logger.js';

const nodeRoutes = new Hono();

// ── Heartbeat from agent (requires NODE_AUTH_TOKEN) ──
nodeRoutes.post('/:id/heartbeat', async (c) => {
  const nodeToken = c.req.header('X-Node-Token');
  const expectedToken = process.env['NODE_AUTH_TOKEN'];

  if (expectedToken) {
    if (!nodeToken || nodeToken !== expectedToken) {
      return c.json({ error: 'Invalid or missing X-Node-Token header' }, 401);
    }
  } else {
    logger.warn('NODE_AUTH_TOKEN is not set — heartbeat endpoint is unprotected (dev mode)');
  }

  const nodeId = c.req.param('id');

  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, nodeId),
  });
  if (!node) {
    return c.json({ error: 'Node not found' }, 404);
  }

  const body = await c.req.json();

  await db.update(nodes).set({ lastHeartbeat: new Date() }).where(eq(nodes.id, nodeId));

  await db.insert(nodeMetrics).values({
    nodeId,
    hostname: body.hostname ?? node.hostname,
    cpuCount: body.cpuCount ?? 0,
    memTotal: body.memTotal ?? 0,
    memUsed: body.memUsed ?? 0,
    memFree: body.memFree ?? 0,
    containerCount: body.containerCount ?? 0,
  });

  return c.json({ ok: true });
});

// ── Authenticated admin routes ──
const adminNodeRoutes = new Hono<{
  Variables: { user: AuthUser };
}>();

adminNodeRoutes.use('*', authMiddleware);

adminNodeRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super users can manage nodes' }, 403);
  }
  await next();
});

// GET / — list swarm nodes
adminNodeRoutes.get('/', async (c) => {
  // Fetch from DB
  const dbNodes = await db.query.nodes.findMany({
    orderBy: (n, { asc }) => asc(n.hostname),
  });

  // Also fetch live Docker node info
  try {
    const dockerNodes = await dockerService.listNodes();
    const dockerMap = new Map(
      dockerNodes.map((n) => [n.ID, n]),
    );

    const merged = dbNodes.map((n) => ({
      ...n,
      docker: n.dockerNodeId ? dockerMap.get(n.dockerNodeId) ?? null : null,
    }));

    return c.json(merged);
  } catch {
    // Docker may not be available (dev mode)
    return c.json(dbNodes);
  }
});

// POST / — register a new node (returns join tokens)
const registerNodeSchema = z.object({
  hostname: z.string().min(1),
  ipAddress: z.string().min(1),
  role: z.enum(['manager', 'worker']).default('worker'),
  labels: z.record(z.string()).default({}),
  nfsServer: z.boolean().default(false),
});

adminNodeRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = registerNodeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [node] = await insertReturning(nodes, {
    hostname: parsed.data.hostname,
    ipAddress: parsed.data.ipAddress,
    role: parsed.data.role,
    labels: parsed.data.labels,
    nfsServer: parsed.data.nfsServer,
    status: 'active',
  });

  // Get swarm join token
  let joinToken = null;
  try {
    const tokens = await dockerService.getSwarmJoinToken();
    joinToken = parsed.data.role === 'manager' ? tokens.manager : tokens.worker;
  } catch {
    // Docker may not be available
  }

  return c.json({ node, joinToken }, 201);
});

// GET /:id — node details
adminNodeRoutes.get('/:id', async (c) => {
  const nodeId = c.req.param('id');

  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, nodeId),
  });

  if (!node) {
    return c.json({ error: 'Node not found' }, 404);
  }

  let dockerInfo = null;
  if (node.dockerNodeId) {
    try {
      dockerInfo = await dockerService.inspectNode(node.dockerNodeId);
    } catch {
      // Node may not be reachable
    }
  }

  return c.json({ ...node, dockerInfo });
});

// PATCH /:id — update node labels/role
const updateNodeSchema = z.object({
  hostname: z.string().min(1).optional(),
  role: z.enum(['manager', 'worker']).optional(),
  labels: z.record(z.string()).optional(),
  nfsServer: z.boolean().optional(),
  dockerNodeId: z.string().optional(),
});

adminNodeRoutes.patch('/:id', async (c) => {
  const nodeId = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateNodeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, nodeId),
  });

  if (!node) {
    return c.json({ error: 'Node not found' }, 404);
  }

  // Update Docker node if possible
  if (node.dockerNodeId && (parsed.data.role || parsed.data.labels)) {
    try {
      await dockerService.updateNode(node.dockerNodeId, {
        role: parsed.data.role,
        labels: parsed.data.labels,
      });
    } catch (err) {
      logger.error({ err }, 'Docker node update failed');
    }
  }

  const [updated] = await updateReturning(nodes, {
    ...parsed.data,
    updatedAt: new Date(),
  }, eq(nodes.id, nodeId));

  return c.json(updated);
});

// DELETE /:id — drain and remove node
adminNodeRoutes.delete('/:id', async (c) => {
  const nodeId = c.req.param('id');

  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, nodeId),
  });

  if (!node) {
    return c.json({ error: 'Node not found' }, 404);
  }

  // Drain and remove from Docker Swarm
  if (node.dockerNodeId) {
    try {
      await dockerService.drainNode(node.dockerNodeId);
      await dockerService.removeNode(node.dockerNodeId, true);
    } catch (err) {
      logger.error({ err }, 'Docker node removal failed');
    }
  }

  await db.delete(nodes).where(eq(nodes.id, nodeId));

  return c.json({ message: 'Node removed' });
});

// POST /:id/drain — drain node
adminNodeRoutes.post('/:id/drain', async (c) => {
  const nodeId = c.req.param('id');

  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, nodeId),
  });

  if (!node || !node.dockerNodeId) {
    return c.json({ error: 'Node not found or not linked to Docker' }, 404);
  }

  try {
    await dockerService.drainNode(node.dockerNodeId);

    await db
      .update(nodes)
      .set({ status: 'draining', updatedAt: new Date() })
      .where(eq(nodes.id, nodeId));

    return c.json({ message: 'Node draining initiated' });
  } catch (err) {
    logger.error({ err }, 'Node drain failed');
    return c.json({ error: 'Failed to drain node' }, 500);
  }
});

// POST /:id/activate — reactivate a drained node
adminNodeRoutes.post('/:id/activate', async (c) => {
  const nodeId = c.req.param('id');

  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, nodeId),
  });

  if (!node || !node.dockerNodeId) {
    return c.json({ error: 'Node not found or not linked to Docker' }, 404);
  }

  try {
    await dockerService.activateNode(node.dockerNodeId);

    await db
      .update(nodes)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(nodes.id, nodeId));

    return c.json({ message: 'Node activated' });
  } catch (err) {
    logger.error({ err }, 'Node activation failed');
    return c.json({ error: 'Failed to activate node' }, 500);
  }
});

// GET /:id/metrics — query node metrics
adminNodeRoutes.get('/:id/metrics', async (c) => {
  const nodeId = c.req.param('id');
  const hours = Math.min(parseInt(c.req.query('hours') ?? '24', 10), 720);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const metrics = await db.query.nodeMetrics.findMany({
    where: and(eq(nodeMetrics.nodeId, nodeId), gte(nodeMetrics.recordedAt, since)),
    orderBy: (m, { asc: a }) => a(m.recordedAt),
  });

  return c.json(metrics);
});

nodeRoutes.route('/', adminNodeRoutes);

export default nodeRoutes;
