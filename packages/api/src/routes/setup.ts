import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { randomBytes } from 'node:crypto';
import { hash } from 'argon2';
import { SignJWT } from 'jose';
import { db, users, accounts, userAccounts, platformSettings, insertReturning, upsert, countSql } from '@fleet/db';
import { orchestrator } from '../services/orchestrator.js';
import { getValkey } from '../services/valkey.service.js';
import { jsonBody, jsonContent, errorResponseSchema, noSecurity } from './_schemas.js';

const setup = new OpenAPIHono();

// In-memory fallback when Valkey is unavailable
let setupInProgressLocal = false;

const SETUP_LOCK_KEY = 'fleet:setup:lock';
const SETUP_LOCK_TTL = 120; // seconds

async function acquireSetupLock(): Promise<boolean> {
  const valkey = await getValkey();
  if (valkey) {
    // Atomic SET NX with TTL — only one instance can acquire
    const result = await valkey.set(SETUP_LOCK_KEY, process.pid.toString(), 'EX', SETUP_LOCK_TTL, 'NX');
    return result === 'OK';
  }
  // Fallback: in-memory (single instance only)
  if (setupInProgressLocal) return false;
  setupInProgressLocal = true;
  return true;
}

async function releaseSetupLock(): Promise<void> {
  const valkey = await getValkey();
  if (valkey) {
    await valkey.del(SETUP_LOCK_KEY);
  }
  setupInProgressLocal = false;
}

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function isSetupComplete(): Promise<boolean> {
  try {
    const [result] = await db.select({ count: countSql() }).from(users);
    return (result?.count ?? 0) > 0;
  } catch {
    // If DB is unreachable, assume setup is complete (safe default).
    // Returning false here would expose the setup wizard to production users.
    return true;
  }
}

// Detect Docker and Swarm state
async function detectDocker(): Promise<{
  available: boolean;
  version?: string;
  swarm: 'active' | 'inactive' | 'pending' | 'error';
  role?: 'manager' | 'worker';
  nodeId?: string;
  managerAddress?: string;
}> {
  try {
    const info = await orchestrator.getClusterInfo();
    // If swarmInspect succeeds, Swarm is active and we're a manager
    return {
      available: true,
      swarm: 'active',
      role: 'manager',
      nodeId: (info as any).NodeID,
      managerAddress: (info as any).JoinTokens
        ? undefined // We're already in the swarm
        : undefined,
    };
  } catch (err: any) {
    // swarmInspect fails if not in swarm or not a manager
    // Try a basic docker ping to see if Docker is available
    try {
      // Use listNodes as a lighter check — if it throws "not a swarm", Docker is there but no swarm
      await orchestrator.listNodes();
      // If this succeeds, swarm is active
      return { available: true, swarm: 'active', role: 'manager' };
    } catch (innerErr: any) {
      const msg = String(innerErr?.message ?? innerErr ?? '');
      if (msg.includes('not a swarm') || msg.includes('This node is not a swarm manager')) {
        return { available: true, swarm: 'inactive' };
      }
      if (msg.includes('ENOENT') || msg.includes('ECONNREFUSED') || msg.includes('socket')) {
        return { available: false, swarm: 'inactive' };
      }
      // Docker is there but something else went wrong
      return { available: true, swarm: 'error' };
    }
  }
}

// ── Response schemas ──

const dockerStateSchema = z.object({
  available: z.boolean(),
  version: z.string().optional(),
  swarm: z.enum(['active', 'inactive', 'pending', 'error']),
  role: z.enum(['manager', 'worker']).optional(),
  nodeId: z.string().optional(),
  managerAddress: z.string().optional(),
}).openapi('DockerState');

const statusResponseSchema = z.object({
  needsSetup: z.boolean(),
  docker: dockerStateSchema,
}).openapi('SetupStatusResponse');

const swarmInitResponseSchema = z.object({
  ok: z.boolean(),
  docker: dockerStateSchema,
}).openapi('SwarmInitResponse');

const setupUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  isSuper: z.boolean(),
  createdAt: z.string().or(z.date()),
}).openapi('SetupUser');

const setupResponseSchema = z.object({
  tokens: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
  }),
  user: setupUserSchema,
}).openapi('SetupResponse');

// ── Request schemas ──

const setupBodySchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128).refine(
    (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw),
    'Password must contain at least one lowercase letter, one uppercase letter, and one digit',
  ),
  domain: z.string().max(255).optional(),
  platformName: z.string().max(255).optional(),
}).openapi('SetupRequest');

// ── Route definitions ──

const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Setup'],
  summary: 'Check if first-run setup is needed and Docker state',
  security: noSecurity,
  responses: {
    200: jsonContent(statusResponseSchema, 'Setup status'),
  },
});

const swarmInitRoute = createRoute({
  method: 'post',
  path: '/swarm-init',
  tags: ['Setup'],
  summary: 'Initialize Docker Swarm on this node',
  security: noSecurity,
  responses: {
    201: jsonContent(swarmInitResponseSchema, 'Swarm initialized successfully'),
    400: jsonContent(errorResponseSchema, 'Docker unavailable or Swarm already active'),
    403: jsonContent(errorResponseSchema, 'Setup already completed'),
    409: jsonContent(errorResponseSchema, 'Setup already in progress'),
    500: jsonContent(errorResponseSchema, 'Internal server error'),
  },
});

const performSetupRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Setup'],
  summary: 'Perform first-run setup and create admin user',
  security: noSecurity,
  request: {
    body: jsonBody(setupBodySchema),
  },
  responses: {
    201: jsonContent(setupResponseSchema, 'Setup completed, admin user created'),
    400: jsonContent(errorResponseSchema, 'Validation error'),
    403: jsonContent(errorResponseSchema, 'Setup already completed'),
    409: jsonContent(errorResponseSchema, 'Setup already in progress'),
    500: jsonContent(errorResponseSchema, 'Internal server error'),
  },
});

// ── Route handlers ──

// GET /status — check if first-run setup is needed + Docker state
setup.openapi(statusRoute, async (c) => {
  const done = await isSetupComplete();
  const docker = await detectDocker();
  return c.json({ needsSetup: !done, docker }, 200);
});

// POST /swarm-init — initialize Docker Swarm on this node
setup.openapi(swarmInitRoute, async (c) => {
  if (await isSetupComplete()) {
    return c.json({ error: 'Setup has already been completed' }, 403);
  }

  if (!(await acquireSetupLock())) {
    return c.json({ error: 'Setup is already in progress' }, 409);
  }

  try {
    const docker = await detectDocker();
    if (!docker.available) {
      return c.json({ error: 'Docker is not available. Install Docker first.' }, 400);
    }
    if (docker.swarm === 'active') {
      return c.json({ error: 'Swarm is already active' }, 400);
    }

    try {
      // Dynamically import dockerode to call swarmInit directly
      const Dockerode = (await import('dockerode')).default;
      const dockerClient = new Dockerode({ socketPath: '/var/run/docker.sock', version: 'v1.45' });
      await dockerClient.swarmInit({
        ListenAddr: '0.0.0.0:2377',
        AdvertiseAddr: '0.0.0.0:2377',
        ForceNewCluster: false,
      });

      // Create the default overlay network for Fleet services
      try {
        await orchestrator.createNetwork('fleet-net', { 'com.fleet.managed': 'true' });
      } catch {
        // Network may already exist
      }

      const updatedDocker = await detectDocker();
      return c.json({ ok: true, docker: updatedDocker }, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to initialize Swarm' }, 500);
    }
  } finally {
    await releaseSetupLock();
  }
});

// POST / — perform first-run setup
setup.openapi(performSetupRoute, async (c) => {
  // Guard: only allow if no users exist
  if (await isSetupComplete()) {
    return c.json({ error: 'Setup has already been completed' }, 403);
  }

  if (!(await acquireSetupLock())) {
    return c.json({ error: 'Setup is already in progress' }, 409);
  }

  try {
    const { name, email, password, domain, platformName } = c.req.valid('json');

    // 1. Hash password
    const passwordHash = await hash(password);

    // 2. Create super admin user (first user is auto-verified)
    const [user] = await insertReturning(users, {
      email,
      passwordHash,
      name,
      isSuper: true,
      emailVerified: true,
    });

    if (!user) {
      return c.json({ error: 'Failed to create admin user' }, 500);
    }

    // 3. Create personal account
    const slug = slugify(name) + '-' + user.id.slice(0, 8);
    const [account] = await insertReturning(accounts, {
      name: `${name}'s Account`,
      slug,
      parentId: null,
      path: slug,
      depth: 0,
      status: 'active',
    });

    if (account) {
      await db.insert(userAccounts).values({
        userId: user.id,
        accountId: account.id,
        role: 'owner',
      });
    }

    // 4. Store platform settings
    if (domain) {
      await upsert(
        platformSettings,
        { id: crypto.randomUUID(), key: 'platform:domain', value: JSON.stringify(domain) },
        platformSettings.key,
        { value: JSON.stringify(domain) },
      );
    }

    if (platformName) {
      await upsert(
        platformSettings,
        { id: crypto.randomUUID(), key: 'platform:name', value: JSON.stringify(platformName) },
        platformSettings.key,
        { value: JSON.stringify(platformName) },
      );
    }

    // 5. Pin stateful services to the current node
    try {
      const hostname = (await orchestrator.runOnLocalHost('hostname', { timeoutMs: 10_000 })).stdout.trim();
      if (hostname) {
        await upsert(
          platformSettings,
          { id: crypto.randomUUID(), key: 'platform:statefulNode', value: hostname },
          platformSettings.key,
          { value: hostname },
        );
        // Also write to env file if not already present
        await orchestrator.runOnLocalHost(
          `grep -q '^FLEET_STATEFUL_NODE=' /opt/fleet/config/env 2>/dev/null || echo "FLEET_STATEFUL_NODE=${hostname}" >> /opt/fleet/config/env`,
          { timeoutMs: 10_000 },
        );
      }
    } catch {
      // Non-fatal — will be auto-detected on next stack deploy
    }

    // 6. Auto-generate JWT secret if not set via env
    let jwtSecret = process.env['JWT_SECRET'];
    if (!jwtSecret) {
      jwtSecret = randomBytes(32).toString('hex');
      process.env['JWT_SECRET'] = jwtSecret;
      // Persist encrypted so it survives restarts
      const { encrypt } = await import('../services/crypto.service.js');
      await upsert(
        platformSettings,
        { id: crypto.randomUUID(), key: 'platform:jwtSecret', value: encrypt(jwtSecret) },
        platformSettings.key,
        { value: encrypt(jwtSecret) },
      );
    }

    // 7. Generate tokens
    const secret = new TextEncoder().encode(jwtSecret);

    const accessToken = await new SignJWT({
      userId: user.id,
      email: user.email!,
      isSuper: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_EXPIRY)
      .sign(secret);

    const refreshToken = await new SignJWT({
      userId: user.id,
      type: 'refresh',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(REFRESH_TOKEN_EXPIRY)
      .sign(secret);

    return c.json({
      tokens: { accessToken, refreshToken },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuper: user.isSuper,
        createdAt: user.createdAt,
      },
    }, 201);
  } finally {
    await releaseSetupLock();
  }
});

export default setup;
