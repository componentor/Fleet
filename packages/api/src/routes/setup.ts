import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { hash } from 'argon2';
import { SignJWT } from 'jose';
import { db, users, accounts, userAccounts, platformSettings, insertReturning, upsert, countSql } from '@hoster/db';

const setup = new Hono();

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

// GET /status — check if first-run setup is needed
setup.get('/status', async (c) => {
  const done = await isSetupComplete();
  return c.json({ needsSetup: !done });
});

// POST / — perform first-run setup
const setupSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  domain: z.string().max(255).optional(),
  platformName: z.string().max(255).optional(),
});

setup.post('/', async (c) => {
  // Guard: only allow if no users exist
  if (await isSetupComplete()) {
    return c.json({ error: 'Setup has already been completed' }, 403);
  }

  const body = await c.req.json();
  const parsed = setupSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { name, email, password, domain, platformName } = parsed.data;

  // 1. Hash password
  const passwordHash = await hash(password);

  // 2. Create super admin user
  const [user] = await insertReturning(users, {
    email,
    passwordHash,
    name,
    isSuper: true,
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
    // Also persist so it survives restarts (admin can retrieve from settings)
    await upsert(
      platformSettings,
      { id: crypto.randomUUID(), key: 'platform:jwtSecret', value: JSON.stringify(jwtSecret) },
      platformSettings.key,
      { value: JSON.stringify(jwtSecret) },
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
});

export default setup;
