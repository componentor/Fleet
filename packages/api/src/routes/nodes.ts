import { Hono } from 'hono';
import { z } from 'zod';
import { db, nodes, insertReturning, updateReturning, eq } from '@hoster/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { dockerService } from '../services/docker.service.js';

const nodeRoutes = new Hono<{
  Variables: { user: AuthUser };
}>();

nodeRoutes.use('*', authMiddleware);

// Super user guard for all node routes
nodeRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Only super users can manage nodes' }, 403);
  }
  await next();
});

// GET / — list swarm nodes
nodeRoutes.get('/', async (c) => {
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

nodeRoutes.post('/', async (c) => {
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
nodeRoutes.get('/:id', async (c) => {
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

nodeRoutes.patch('/:id', async (c) => {
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
      console.error('Docker node update failed:', err);
    }
  }

  const [updated] = await updateReturning(nodes, {
    ...parsed.data,
    updatedAt: new Date(),
  }, eq(nodes.id, nodeId));

  return c.json(updated);
});

// DELETE /:id — drain and remove node
nodeRoutes.delete('/:id', async (c) => {
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
      console.error('Docker node removal failed:', err);
    }
  }

  await db.delete(nodes).where(eq(nodes.id, nodeId));

  return c.json({ message: 'Node removed' });
});

// POST /:id/drain — drain node
nodeRoutes.post('/:id/drain', async (c) => {
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
    console.error('Node drain failed:', err);
    return c.json({ error: 'Failed to drain node' }, 500);
  }
});

// POST /:id/activate — reactivate a drained node
nodeRoutes.post('/:id/activate', async (c) => {
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
    console.error('Node activation failed:', err);
    return c.json({ error: 'Failed to activate node' }, 500);
  }
});

export default nodeRoutes;
