import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { hash } from 'argon2';
import { SignJWT } from 'jose';
import { db, users, accounts, userAccounts, platformSettings, insertReturning, upsert, countSql } from '@fleet/db';
import { dockerService } from '../services/docker.service.js';

const setup = new Hono();

let setupInProgress = false;

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function isSetupComplete(): Promise<boolean> {
  const [result] = await db.select({ count: countSql() }).from(users);
  return (result?.count ?? 0) > 0;
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
    const info = await dockerService.getSwarmInfo();
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
      await dockerService.listNodes();
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

// GET /status — check if first-run setup is needed + Docker state
setup.get('/status', async (c) => {
  const done = await isSetupComplete();
  const docker = await detectDocker();
  return c.json({ needsSetup: !done, docker });
});

// POST /swarm-init — initialize Docker Swarm on this node
setup.post('/swarm-init', async (c) => {
  if (await isSetupComplete()) {
    return c.json({ error: 'Setup has already been completed' }, 403);
  }

  if (setupInProgress) {
    return c.json({ error: 'Setup is already in progress' }, 409);
  }
  setupInProgress = true;

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
      const dockerClient = new Dockerode({ socketPath: '/var/run/docker.sock' });
      await dockerClient.swarmInit({
        ListenAddr: '0.0.0.0:2377',
        AdvertiseAddr: '0.0.0.0:2377',
        ForceNewCluster: false,
      });

      // Create the default overlay network for Fleet services
      try {
        await dockerService.createNetwork('fleet-net', { 'com.fleet.managed': 'true' });
      } catch {
        // Network may already exist
      }

      const updatedDocker = await detectDocker();
      return c.json({ ok: true, docker: updatedDocker }, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to initialize Swarm' }, 500);
    }
  } finally {
    setupInProgress = false;
  }
});

// POST / — perform first-run setup
const setupSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128).refine(
    (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw),
    'Password must contain at least one lowercase letter, one uppercase letter, and one digit',
  ),
  domain: z.string().max(255).optional(),
  platformName: z.string().max(255).optional(),
});

setup.post('/', async (c) => {
  // Guard: only allow if no users exist
  if (await isSetupComplete()) {
    return c.json({ error: 'Setup has already been completed' }, 403);
  }

  if (setupInProgress) {
    return c.json({ error: 'Setup is already in progress' }, 409);
  }
  setupInProgress = true;

  try {
    const body = await c.req.json();
    const parsed = setupSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Validation failed' }, 400);
    }

    const { name, email, password, domain, platformName } = parsed.data;

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

    // 5. Auto-generate JWT secret if not set via env
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

    // 6. Generate tokens
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
    setupInProgress = false;
  }
});

export default setup;
