import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { db, nodes, nodeMetrics, insertReturning, updateReturning, eq, and, gte, desc, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { dockerService } from '../services/docker.service.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { getValkey } from '../services/valkey.service.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity, noSecurity } from './_schemas.js';

// Heartbeat rate limit: keyed by node ID (not IP) since agents share Docker overlay IPs
const heartbeatRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: 'heartbeat', keyFn: (c) => c.req.param('id') ?? 'unknown' });

const heartbeatSchema = z.object({
  hostname: z.string().max(255).optional(),
  cpuCount: z.number().int().min(0).max(1024).optional(),
  memTotal: z.number().min(0).optional(),
  memUsed: z.number().min(0).optional(),
  memFree: z.number().min(0).optional(),
  containerCount: z.number().int().min(0).max(100000).optional(),
  containerBandwidth: z.record(z.string(), z.object({
    rx: z.number().min(0),
    tx: z.number().min(0),
  })).optional(),
  diskTotal: z.number().min(0).optional(),
  diskUsed: z.number().min(0).optional(),
  diskFree: z.number().min(0).optional(),
  diskType: z.enum(['ssd', 'hdd', 'nvme', 'unknown']).optional(),
});

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const nodeRoutes = new OpenAPIHono();

// ── Heartbeat route definition ──

const heartbeatRoute = createRoute({
  method: 'post',
  path: '/{id}/heartbeat',
  tags: ['Nodes'],
  summary: 'Agent heartbeat',
  security: noSecurity,
  middleware: [heartbeatRateLimit] as const,
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'Node ID or Docker Swarm node ID' }),
    }),
    body: jsonBody(heartbeatSchema),
  },
  responses: {
    200: jsonContent(z.object({ ok: z.boolean() }), 'Heartbeat accepted'),
    400: jsonContent(errorResponseSchema, 'Invalid JSON or validation error'),
    401: jsonContent(errorResponseSchema, 'Unauthorized'),
    404: jsonContent(errorResponseSchema, 'Node not found'),
    500: jsonContent(errorResponseSchema, 'Server misconfiguration'),
  },
});

nodeRoutes.openapi(heartbeatRoute, (async (c: any) => {
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

  const { id: nodeId } = c.req.valid('param');
  const hb = c.req.valid('json');

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
    diskTotal: hb.diskTotal ?? 0,
    diskUsed: hb.diskUsed ?? 0,
    diskFree: hb.diskFree ?? 0,
    diskType: hb.diskType ?? 'unknown',
  });

  // Store per-container bandwidth snapshots in Valkey for usage collection
  if (hb.containerBandwidth && Object.keys(hb.containerBandwidth).length > 0) {
    const valkey = await getValkey();
    if (valkey) {
      const BW_KEY_PREFIX = 'fleet:bw:snapshot:';
      const BW_TTL = 600; // 10 minutes — 2x collection interval
      const pipeline = valkey.pipeline();
      for (const [containerId, stats] of Object.entries(hb.containerBandwidth as Record<string, { rx: number; tx: number }>)) {
        pipeline.set(
          `${BW_KEY_PREFIX}${containerId}`,
          JSON.stringify({ rx: stats.rx, tx: stats.tx, nodeId: node.id }),
          'EX',
          BW_TTL,
        );
      }
      pipeline.exec().catch((err) => {
        logger.warn({ err }, 'Failed to store container bandwidth in Valkey');
      });
    }
  }

  return c.json({ ok: true });
}) as any);

// ── Authenticated admin routes ──
const adminNodeRoutes = new OpenAPIHono<{
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

// ── Schemas ──

const registerNodeSchema = z.object({
  hostname: z.string().min(1),
  ipAddress: z.string().min(1),
  role: z.enum(['manager', 'worker']).default('worker'),
  labels: z.record(z.string(), z.string()).default({}),
  nfsServer: z.boolean().default(false),
  location: z.string().max(50).nullable().optional(),
});

const updateNodeSchema = z.object({
  hostname: z.string().min(1).optional(),
  role: z.enum(['manager', 'worker']).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  nfsServer: z.boolean().optional(),
  dockerNodeId: z.string().optional(),
  location: z.string().max(50).nullable().optional(),
});

const nodeIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Node ID' }),
});

const probeSchema = z.object({
  ports: z.array(z.number().int().min(1).max(65535)).default([22, 111, 2049, 24007, 24008, 9000, 9001, 6789, 3300, 6800]),
  timeout: z.number().int().min(500).max(10000).default(3000),
});

const probeRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: 'node-probe' });

// ── Route definitions ──

const listNodesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Nodes'],
  summary: 'List swarm nodes',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'List of nodes with Docker info'),
    ...standardErrors,
  },
});

const registerNodeRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Nodes'],
  summary: 'Register a new node',
  security: bearerSecurity,
  request: {
    body: jsonBody(registerNodeSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Node registered with join token'),
    400: jsonContent(errorResponseSchema, 'Validation error'),
    409: jsonContent(errorResponseSchema, 'Duplicate node'),
  },
});

const getNodeRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Nodes'],
  summary: 'Get node details',
  security: bearerSecurity,
  request: {
    params: nodeIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Node details with Docker info'),
    404: jsonContent(errorResponseSchema, 'Node not found'),
  },
});

const updateNodeRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Nodes'],
  summary: 'Update node labels/role',
  security: bearerSecurity,
  request: {
    params: nodeIdParamSchema,
    body: jsonBody(updateNodeSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated node'),
    400: jsonContent(errorResponseSchema, 'Validation error'),
    404: jsonContent(errorResponseSchema, 'Node not found'),
  },
});

const deleteNodeRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Nodes'],
  summary: 'Drain and remove node',
  security: bearerSecurity,
  request: {
    params: nodeIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Node removed'),
    404: jsonContent(errorResponseSchema, 'Node not found'),
  },
});

const drainNodeRoute = createRoute({
  method: 'post',
  path: '/{id}/drain',
  tags: ['Nodes'],
  summary: 'Drain node',
  security: bearerSecurity,
  request: {
    params: nodeIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Node draining initiated'),
    404: jsonContent(errorResponseSchema, 'Node not found or not linked to Docker'),
    500: jsonContent(errorResponseSchema, 'Failed to drain node'),
  },
});

const activateNodeRoute = createRoute({
  method: 'post',
  path: '/{id}/activate',
  tags: ['Nodes'],
  summary: 'Reactivate a drained node',
  security: bearerSecurity,
  request: {
    params: nodeIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Node activated'),
    404: jsonContent(errorResponseSchema, 'Node not found or not linked to Docker'),
    500: jsonContent(errorResponseSchema, 'Failed to activate node'),
  },
});

const getNodeMetricsRoute = createRoute({
  method: 'get',
  path: '/{id}/metrics',
  tags: ['Nodes'],
  summary: 'Query node metrics',
  security: bearerSecurity,
  request: {
    params: nodeIdParamSchema,
    query: z.object({
      hours: z.string().optional().openapi({ description: 'Number of hours to query (1-720, default 24)' }),
    }),
  },
  responses: {
    200: jsonContent(z.any(), 'Node metrics'),
    ...standardErrors,
  },
});

const probeNodeRoute = createRoute({
  method: 'post',
  path: '/{id}/probe',
  tags: ['Nodes'],
  summary: 'Run diagnostics on a node',
  security: bearerSecurity,
  middleware: [probeRateLimit] as const,
  request: {
    params: nodeIdParamSchema,
    body: jsonBody(probeSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Node probe results with port checks and recommendations'),
    400: jsonContent(errorResponseSchema, 'Validation error'),
    404: jsonContent(errorResponseSchema, 'Node not found'),
  },
});

// ── Port probe helpers ──

const PORT_SERVICES: Record<number, { name: string; required: boolean }> = {
  22:    { name: 'SSH', required: true },
  111:   { name: 'RPCBind', required: true },
  2049:  { name: 'NFS', required: true },
  24007: { name: 'GlusterFS daemon', required: true },
  24008: { name: 'GlusterFS management', required: false },  // activates when volumes are created
  9000:  { name: 'MinIO S3 API', required: false },            // deployed by Fleet during init
  9001:  { name: 'MinIO Console', required: false },            // deployed by Fleet during init
  6789:  { name: 'Ceph MON (v1)', required: false },            // only if using Ceph
  3300:  { name: 'Ceph MON (v2)', required: false },            // only if using Ceph
  6800:  { name: 'Ceph OSD', required: false },                 // only if using Ceph
};

/**
 * Test TCP connectivity to a single port on a given host.
 * Returns whether the port is open and the connection latency in ms.
 */
function checkPort(host: string, port: number, timeoutMs: number): Promise<{ port: number; open: boolean; latencyMs: number | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port, timeout: timeoutMs });

    const cleanup = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        port,
        open,
        latencyMs: open ? Date.now() - start : null,
      });
    };

    socket.on('connect', () => cleanup(true));
    socket.on('timeout', () => cleanup(false));
    socket.on('error', () => cleanup(false));
  });
}

// ── Route handlers ──

// GET / — list swarm nodes
adminNodeRoutes.openapi(listNodesRoute, (async (c: any) => {
  // Fetch from DB
  const dbNodes = await db.query.nodes.findMany({
    orderBy: (n: any, { asc }: any) => asc(n.hostname),
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
}) as any);

// POST / — register a new node (returns join tokens)
adminNodeRoutes.openapi(registerNodeRoute, (async (c: any) => {
  const data = c.req.valid('json');

  // Prevent duplicate registration by hostname + IP
  const existing = await db.query.nodes.findFirst({
    where: and(eq(nodes.hostname, data.hostname), eq(nodes.ipAddress, data.ipAddress)),
  });
  if (existing) {
    return c.json({ error: 'A node with this hostname and IP already exists', existingNodeId: existing.id }, 409);
  }

  const [node] = await insertReturning(nodes, {
    hostname: data.hostname,
    ipAddress: data.ipAddress,
    role: data.role,
    labels: data.labels,
    nfsServer: data.nfsServer,
    location: data.location ?? null,
    status: 'active',
  });

  // Get swarm join token
  let joinToken = null;
  try {
    const tokens = await dockerService.getSwarmJoinToken();
    joinToken = data.role === 'manager' ? tokens.manager : tokens.worker;
  } catch {
    // Docker may not be available
  }

  return c.json({ node, joinToken }, 201);
}) as any);

// GET /:id — node details
adminNodeRoutes.openapi(getNodeRoute, (async (c: any) => {
  const { id: nodeId } = c.req.valid('param');

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
}) as any);

// PATCH /:id — update node labels/role
adminNodeRoutes.openapi(updateNodeRoute, (async (c: any) => {
  const { id: nodeId } = c.req.valid('param');
  const data = c.req.valid('json');

  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, nodeId),
  });

  if (!node) {
    return c.json({ error: 'Node not found' }, 404);
  }

  // Update Docker node if possible (role, labels, or region change)
  if (node.dockerNodeId && (data.role || data.labels || data.location !== undefined)) {
    try {
      // Merge region into Docker labels so placement constraints work
      const mergedLabels = { ...(data.labels ?? (node.labels as Record<string, string>) ?? {}) };
      if (data.location !== undefined) {
        if (data.location) {
          mergedLabels['region'] = data.location;
        } else {
          delete mergedLabels['region'];
        }
      }
      await dockerService.updateNode(node.dockerNodeId, {
        role: data.role,
        labels: mergedLabels,
      });
    } catch (err) {
      logger.error({ err }, 'Docker node update failed');
      logToErrorTable({ level: 'error', message: `Docker node update failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'nodes', operation: 'docker-node-update' } });
    }
  }

  const [updated] = await updateReturning(nodes, {
    ...data,
    updatedAt: new Date(),
  }, eq(nodes.id, nodeId));

  return c.json(updated);
}) as any);

// DELETE /:id — drain and remove node
adminNodeRoutes.openapi(deleteNodeRoute, (async (c: any) => {
  const { id: nodeId } = c.req.valid('param');

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
      logToErrorTable({ level: 'error', message: `Docker node removal failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'nodes', operation: 'docker-drain-remove' } });
    }
  }

  await db.delete(nodes).where(eq(nodes.id, nodeId));

  return c.json({ message: 'Node removed' });
}) as any);

// POST /:id/drain — drain node
adminNodeRoutes.openapi(drainNodeRoute, (async (c: any) => {
  const { id: nodeId } = c.req.valid('param');

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
    logToErrorTable({ level: 'error', message: `Node drain failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'nodes', operation: 'drain-node' } });
    return c.json({ error: 'Failed to drain node' }, 500);
  }
}) as any);

// POST /:id/activate — reactivate a drained node
adminNodeRoutes.openapi(activateNodeRoute, (async (c: any) => {
  const { id: nodeId } = c.req.valid('param');

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
    logToErrorTable({ level: 'error', message: `Node activation failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'nodes', operation: 'activate-node' } });
    return c.json({ error: 'Failed to activate node' }, 500);
  }
}) as any);

// GET /:id/metrics — query node metrics
adminNodeRoutes.openapi(getNodeMetricsRoute, (async (c: any) => {
  const { id: nodeId } = c.req.valid('param');
  const queryHours = c.req.valid('query')?.hours;
  const hours = Math.min(Math.max(1, parseInt(queryHours ?? '24', 10) || 24), 720);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const metrics = await db.query.nodeMetrics.findMany({
    where: and(eq(nodeMetrics.nodeId, nodeId), gte(nodeMetrics.recordedAt, since)),
    orderBy: (m: any, { asc: a }: any) => a(m.recordedAt),
  });

  return c.json(metrics);
}) as any);

// POST /:id/probe — Run diagnostics on a node
adminNodeRoutes.openapi(probeNodeRoute, (async (c: any) => {
  const { id: nodeId } = c.req.valid('param');

  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, nodeId),
  });

  if (!node) {
    return c.json({ error: 'Node not found' }, 404);
  }

  const { ports, timeout } = c.req.valid('json');

  // Run all port checks concurrently
  const portResults = await Promise.allSettled(
    ports.map((port: number) => checkPort(node.ipAddress, port, timeout)),
  );

  const portReport = portResults.map((result, idx) => {
    if (result.status === 'fulfilled') {
      const info = PORT_SERVICES[result.value.port];
      return {
        port: result.value.port,
        service: info?.name ?? 'Unknown',
        required: info?.required ?? false,
        open: result.value.open,
        latencyMs: result.value.latencyMs,
      };
    }
    // Should not happen with checkPort's error handling, but handle defensively
    const fallbackPort = ports[idx] ?? 0;
    const info = PORT_SERVICES[fallbackPort];
    return {
      port: fallbackPort,
      service: info?.name ?? 'Unknown',
      required: info?.required ?? false,
      open: false,
      latencyMs: null,
    };
  });

  // Fetch the latest metrics for this node
  const latestMetric = await db.query.nodeMetrics.findFirst({
    where: eq(nodeMetrics.nodeId, nodeId),
    orderBy: (m: any) => desc(m.recordedAt),
  });

  const metricsReport = {
    cpuCount: latestMetric?.cpuCount ?? null,
    memTotal: latestMetric?.memTotal ?? null,
    memFree: latestMetric?.memFree ?? null,
    diskTotal: (latestMetric as any)?.diskTotal ?? null,
    diskUsed: (latestMetric as any)?.diskUsed ?? null,
    diskFree: (latestMetric as any)?.diskFree ?? null,
    diskType: (latestMetric as any)?.diskType ?? null,
    containerCount: latestMetric?.containerCount ?? null,
  };

  // Build a lookup set of open ports for fast access
  const openPorts = new Set(portReport.filter((p) => p.open).map((p) => p.port));

  const FIFTY_GB = 50 * 1024 * 1024 * 1024; // 50 GiB in bytes
  const diskFree = metricsReport.diskFree as number | null;
  const diskSpaceAdequate = diskFree != null ? diskFree > FIFTY_GB : false;
  const nfsPorts = openPorts.has(2049) && openPorts.has(111);
  const glusterfsPorts = openPorts.has(24007); // 24008 activates after volume creation
  const suitableForStorage = diskSpaceAdequate;
  const containerCount = metricsReport.containerCount as number | null;
  const suggestedRole = (containerCount != null && containerCount > 0) ? 'storage+compute' : 'storage';

  return c.json({
    nodeId: node.id,
    hostname: node.hostname,
    ipAddress: node.ipAddress,
    ports: portReport,
    metrics: metricsReport,
    recommendations: {
      suitableForStorage,
      diskSpaceAdequate,
      nfsPorts,
      glusterfsPorts,
      suggestedRole,
    },
  });
}) as any);

nodeRoutes.route('/', adminNodeRoutes);

export default nodeRoutes;
