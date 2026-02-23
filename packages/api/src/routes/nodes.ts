import { Hono } from 'hono';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { db, nodes, nodeMetrics, insertReturning, updateReturning, eq, and, gte, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { dockerService } from '../services/docker.service.js';
import { logger } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';

// All node agents share the Docker overlay IP, so this limit is per-cluster not per-node
const heartbeatRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 300, keyPrefix: 'heartbeat' });

const heartbeatSchema = z.object({
  hostname: z.string().max(255).optional(),
  cpuCount: z.number().int().min(0).max(1024).optional(),
  memTotal: z.number().min(0).optional(),
  memUsed: z.number().min(0).optional(),
  memFree: z.number().min(0).optional(),
  containerCount: z.number().int().min(0).max(100000).optional(),
});

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const nodeRoutes = new Hono();

// ── Heartbeat from agent (requires NODE_AUTH_TOKEN in production) ──
nodeRoutes.post('/:id/heartbeat', heartbeatRateLimit, async (c) => {
  const expectedToken = process.env['NODE_AUTH_TOKEN'];

  if (expectedToken) {
    const authHeader = c.req.header('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!bearerToken || !safeTokenCompare(bearerToken, expectedToken)) {
      return c.json({ error: 'Invalid or missing Authorization header' }, 401);
    }
  } else if (process.env.NODE_ENV === 'production') {
    logger.error('NODE_AUTH_TOKEN is not configured — rejecting heartbeat');
    return c.json({ error: 'Server misconfiguration: NODE_AUTH_TOKEN is not set' }, 500);
  }

  const nodeId = c.req.param('id');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const hb = parsed.data;

  // Agents may send a Docker Swarm node ID or 'unknown' — look up by dockerNodeId or id
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let node: typeof nodes.$inferSelect | undefined;

  if (UUID_RE.test(nodeId)) {
    node = await db.query.nodes.findFirst({
      where: eq(nodes.id, nodeId),
    });
  }

  // If not found by UUID, try matching by dockerNodeId (Docker Swarm node ID)
  if (!node && nodeId !== 'unknown') {
    node = await db.query.nodes.findFirst({
      where: eq(nodes.dockerNodeId, nodeId),
    });
  }

  // Auto-register the node on first heartbeat (reuse existing by hostname to prevent duplicates)
  if (!node) {
    const reportedHostname = hb.hostname ?? 'unknown';
    // Try to get the real IP from request headers
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? '0.0.0.0';

    const existing = await db.query.nodes.findFirst({
      where: eq(nodes.hostname, reportedHostname),
    });
    if (existing) {
      node = existing;
      const updates: Record<string, any> = {};
      // Update dockerNodeId if agent now provides one
      if (nodeId !== 'unknown' && !existing.dockerNodeId) {
        updates.dockerNodeId = nodeId;
      }
      // Update IP if we now have a real one
      if (clientIp !== '0.0.0.0' && existing.ipAddress === '0.0.0.0') {
        updates.ipAddress = clientIp;
      }
      if (Object.keys(updates).length > 0) {
        await db.update(nodes).set(updates).where(eq(nodes.id, existing.id));
      }
    } else {
      const [created] = await insertReturning(nodes, {
        hostname: reportedHostname,
        dockerNodeId: nodeId !== 'unknown' ? nodeId : null,
        ipAddress: clientIp,
        role: 'manager',
        status: 'active',
      });
      node = created;
      if (node) {
        logger.info(`Auto-registered node: ${node.id} (${node.hostname}, swarm: ${nodeId})`);
      }
    }
  }

  if (!node) {
    return c.json({ error: 'Node not found' }, 404);
  }

  await db.update(nodes).set({ lastHeartbeat: new Date() }).where(eq(nodes.id, node.id));

  await db.insert(nodeMetrics).values({
    nodeId: node.id,
    hostname: hb.hostname ?? node.hostname,
    cpuCount: hb.cpuCount ?? 0,
    memTotal: hb.memTotal ?? 0,
    memUsed: hb.memUsed ?? 0,
    memFree: hb.memFree ?? 0,
    containerCount: hb.containerCount ?? 0,
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

  // Also fetch live Docker node info and sync back to DB
  try {
    const dockerNodes = await dockerService.listNodes();
    const dockerMap = new Map(
      dockerNodes.map((n: any) => [n.ID, n]),
    );

    const merged = await Promise.all(dbNodes.map(async (n) => {
      const dockerNode = n.dockerNodeId ? dockerMap.get(n.dockerNodeId) ?? null : null;

      // Sync real IP/hostname/status from Docker Swarm into DB
      if (dockerNode) {
        const updates: Record<string, any> = {};
        const dockerAddr = (dockerNode as any).Status?.Addr;
        const dockerHostname = (dockerNode as any).Description?.Hostname;
        const dockerStatus = (dockerNode as any).Status?.State; // "ready" | "down" | "disconnected"

        if (dockerAddr && dockerAddr !== '0.0.0.0' && n.ipAddress === '0.0.0.0') {
          updates.ipAddress = dockerAddr;
        }
        // Sync hostname if current one looks like a container ID (12 hex chars)
        if (dockerHostname && /^[0-9a-f]{12}$/i.test(n.hostname)) {
          updates.hostname = dockerHostname;
        }
        // Sync status from Docker
        if (dockerStatus === 'ready' && n.status !== 'active' && n.status !== 'draining') {
          updates.status = 'active';
        } else if (dockerStatus === 'down' || dockerStatus === 'disconnected') {
          updates.status = 'offline';
        }

        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          await db.update(nodes).set(updates).where(eq(nodes.id, n.id));
          Object.assign(n, updates);
        }
      }

      return { ...n, docker: dockerNode };
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
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = registerNodeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  // Prevent duplicate registration by hostname + IP
  const existing = await db.query.nodes.findFirst({
    where: and(eq(nodes.hostname, parsed.data.hostname), eq(nodes.ipAddress, parsed.data.ipAddress)),
  });
  if (existing) {
    return c.json({ error: 'A node with this hostname and IP already exists', existingNodeId: existing.id }, 409);
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
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = updateNodeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
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
  const hours = Math.min(Math.max(1, parseInt(c.req.query('hours') ?? '24', 10) || 24), 720);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const metrics = await db.query.nodeMetrics.findMany({
    where: and(eq(nodeMetrics.nodeId, nodeId), gte(nodeMetrics.recordedAt, since)),
    orderBy: (m, { asc: a }) => a(m.recordedAt),
  });

  return c.json(metrics);
});

nodeRoutes.route('/', adminNodeRoutes);

export default nodeRoutes;
