import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, registryCredentials, oauthProviders, insertReturning, eq, and, isNull, or } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { encrypt, decrypt } from '../services/crypto.service.js';
import { logger } from '../services/logger.js';
import { jsonBody, jsonContent, standardErrors, bearerSecurity } from './_schemas.js';
import { createMiddleware } from 'hono/factory';

/** Only super users can manage platform-wide registry credentials */
const requireSuper = createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super admin access required' }, 403);
  }
  await next();
});

const registryCredentialRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

registryCredentialRoutes.use('*', authMiddleware);

// ────────────────────────────────────────────────────────────────────────────
// Platform-wide routes (super admin only, accountId IS NULL)
// ────────────────────────────────────────────────────────────────────────────

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Registry Credentials'],
  summary: 'List platform-wide registry credentials (super admin only)',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      credentials: z.array(z.object({
        id: z.string(),
        registry: z.string(),
        username: z.string(),
        createdAt: z.string().nullable(),
      })),
    }), 'List of credentials'),
    ...standardErrors,
  },
  middleware: [requireSuper, requireScope('read')],
});

registryCredentialRoutes.openapi(listRoute, (async (c: any) => {
  const creds = await db.query.registryCredentials.findMany({
    where: isNull(registryCredentials.accountId),
  });

  return c.json({
    credentials: creds.map((cr: any) => ({
      id: cr.id,
      registry: cr.registry,
      username: cr.username,
      createdAt: cr.createdAt ? new Date(cr.createdAt).toISOString() : null,
    })),
  });
}) as any);

const addRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Registry Credentials'],
  summary: 'Add a platform-wide registry credential (super admin only)',
  security: bearerSecurity,
  request: {
    body: jsonBody(z.object({
      registry: z.string().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.:_-]*$/, 'Invalid registry hostname'),
      username: z.string().min(1).max(255),
      password: z.string().min(1).max(10000),
    })),
  },
  responses: {
    201: jsonContent(z.object({ id: z.string(), registry: z.string(), username: z.string() }), 'Credential created'),
    ...standardErrors,
  },
  middleware: [requireSuper, requireScope('write')],
});

registryCredentialRoutes.openapi(addRoute, (async (c: any) => {
  const { registry, username, password } = c.req.valid('json');

  const existing = await db.query.registryCredentials.findFirst({
    where: and(isNull(registryCredentials.accountId), eq(registryCredentials.registry, registry)),
  });

  if (existing) {
    await db.update(registryCredentials)
      .set({ username, password: encrypt(password), updatedAt: new Date() })
      .where(eq(registryCredentials.id, existing.id));
    return c.json({ id: existing.id, registry, username }, 201);
  }

  const [cred] = await insertReturning(registryCredentials, {
    accountId: null,
    registry,
    username,
    password: encrypt(password),
  });

  return c.json({ id: cred!.id, registry, username }, 201);
}) as any);

const githubRoute = createRoute({
  method: 'post',
  path: '/github',
  tags: ['Registry Credentials'],
  summary: 'Connect GitHub Packages platform-wide (super admin only)',
  security: bearerSecurity,
  responses: {
    201: jsonContent(z.object({ id: z.string(), registry: z.string(), username: z.string() }), 'GitHub Packages credential created'),
    ...standardErrors,
  },
  middleware: [requireSuper, requireScope('write')],
});

registryCredentialRoutes.openapi(githubRoute, (async (c: any) => {
  const user: AuthUser = c.get('user');
  return await connectGitHubPackages(c, user, null);
}) as any);

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Registry Credentials'],
  summary: 'Remove a platform-wide registry credential (super admin only)',
  security: bearerSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(z.object({ message: z.string() }), 'Credential removed'),
    ...standardErrors,
  },
  middleware: [requireSuper, requireScope('write')],
});

registryCredentialRoutes.openapi(deleteRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const cred = await db.query.registryCredentials.findFirst({
    where: and(eq(registryCredentials.id, id), isNull(registryCredentials.accountId)),
  });
  if (!cred) return c.json({ error: 'Credential not found' }, 404);
  await db.delete(registryCredentials).where(eq(registryCredentials.id, id));
  return c.json({ message: 'Credential removed' });
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// Account-scoped routes (customers manage their own creds)
// ────────────────────────────────────────────────────────────────────────────

const accountListRoute = createRoute({
  method: 'get',
  path: '/account',
  tags: ['Registry Credentials'],
  summary: 'List account registry credentials',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      credentials: z.array(z.object({
        id: z.string(),
        registry: z.string(),
        username: z.string(),
        createdAt: z.string().nullable(),
      })),
    }), 'List of account credentials'),
    ...standardErrors,
  },
  middleware: [tenantMiddleware, requireMember, requireScope('read')],
});

registryCredentialRoutes.openapi(accountListRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const creds = await db.query.registryCredentials.findMany({
    where: eq(registryCredentials.accountId, accountId),
  });

  return c.json({
    credentials: creds.map((cr: any) => ({
      id: cr.id,
      registry: cr.registry,
      username: cr.username,
      createdAt: cr.createdAt ? new Date(cr.createdAt).toISOString() : null,
    })),
  });
}) as any);

const accountAddRoute = createRoute({
  method: 'post',
  path: '/account',
  tags: ['Registry Credentials'],
  summary: 'Add an account registry credential',
  security: bearerSecurity,
  request: {
    body: jsonBody(z.object({
      registry: z.string().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.:_-]*$/, 'Invalid registry hostname'),
      username: z.string().min(1).max(255),
      password: z.string().min(1).max(10000),
    })),
  },
  responses: {
    201: jsonContent(z.object({ id: z.string(), registry: z.string(), username: z.string() }), 'Credential created'),
    ...standardErrors,
  },
  middleware: [tenantMiddleware, requireMember, requireScope('write')],
});

registryCredentialRoutes.openapi(accountAddRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { registry, username, password } = c.req.valid('json');

  const existing = await db.query.registryCredentials.findFirst({
    where: and(eq(registryCredentials.accountId, accountId), eq(registryCredentials.registry, registry)),
  });

  if (existing) {
    await db.update(registryCredentials)
      .set({ username, password: encrypt(password), updatedAt: new Date() })
      .where(eq(registryCredentials.id, existing.id));
    return c.json({ id: existing.id, registry, username }, 201);
  }

  const [cred] = await insertReturning(registryCredentials, {
    accountId,
    registry,
    username,
    password: encrypt(password),
  });

  return c.json({ id: cred!.id, registry, username }, 201);
}) as any);

const accountGithubRoute = createRoute({
  method: 'post',
  path: '/account/github',
  tags: ['Registry Credentials'],
  summary: 'Connect GitHub Packages for account',
  security: bearerSecurity,
  responses: {
    201: jsonContent(z.object({ id: z.string(), registry: z.string(), username: z.string() }), 'GitHub Packages credential created'),
    ...standardErrors,
  },
  middleware: [tenantMiddleware, requireMember, requireScope('write')],
});

registryCredentialRoutes.openapi(accountGithubRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);
  const user: AuthUser = c.get('user');
  return await connectGitHubPackages(c, user, accountId);
}) as any);

const accountDeleteRoute = createRoute({
  method: 'delete',
  path: '/account/{id}',
  tags: ['Registry Credentials'],
  summary: 'Remove an account registry credential',
  security: bearerSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(z.object({ message: z.string() }), 'Credential removed'),
    ...standardErrors,
  },
  middleware: [tenantMiddleware, requireMember, requireScope('write')],
});

registryCredentialRoutes.openapi(accountDeleteRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const cred = await db.query.registryCredentials.findFirst({
    where: and(eq(registryCredentials.id, id), eq(registryCredentials.accountId, accountId)),
  });
  if (!cred) return c.json({ error: 'Credential not found' }, 404);

  await db.delete(registryCredentials).where(eq(registryCredentials.id, id));
  return c.json({ message: 'Credential removed' });
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// Available registries (merges platform-wide + account-specific for deploy UI)
// ────────────────────────────────────────────────────────────────────────────

const availableRoute = createRoute({
  method: 'get',
  path: '/available',
  tags: ['Registry Credentials'],
  summary: 'List all registries available to the current account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      registries: z.array(z.object({
        registry: z.string(),
        username: z.string(),
        scope: z.enum(['platform', 'account']),
      })),
    }), 'Available registries'),
    ...standardErrors,
  },
  middleware: [tenantMiddleware, requireMember, requireScope('read')],
});

registryCredentialRoutes.openapi(availableRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const creds = await db.query.registryCredentials.findMany({
    where: or(eq(registryCredentials.accountId, accountId), isNull(registryCredentials.accountId)),
  });

  // Account-specific creds override platform-wide for same registry
  const registryMap = new Map<string, { registry: string; username: string; scope: 'platform' | 'account' }>();
  for (const cr of creds) {
    const scope = cr.accountId ? 'account' : 'platform';
    const existing = registryMap.get(cr.registry);
    // Account-specific always wins
    if (!existing || scope === 'account') {
      registryMap.set(cr.registry, { registry: cr.registry, username: cr.username, scope });
    }
  }

  return c.json({ registries: Array.from(registryMap.values()) });
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────────

async function connectGitHubPackages(c: any, user: AuthUser, accountId: string | null) {
  const oauth = await db.query.oauthProviders.findFirst({
    where: and(
      eq(oauthProviders.userId, user.userId),
      eq(oauthProviders.provider, 'github'),
    ),
  });

  if (!oauth?.accessToken) {
    return c.json({ error: 'GitHub account not connected. Link your GitHub account first.' }, 400);
  }

  const token = decrypt(oauth.accessToken);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return c.json({ error: 'GitHub token is invalid or expired. Re-connect your GitHub account.' }, 400);
    }

    const scopes = res.headers.get('x-oauth-scopes') || '';
    if (!scopes.split(',').map((s: string) => s.trim()).includes('read:packages')) {
      return c.json({ error: 'GitHub token lacks read:packages scope. Disconnect and re-connect your GitHub account to grant access.' }, 400);
    }

    const ghUser = (await res.json()) as { login: string };

    // Upsert credential for ghcr.io
    const whereClause = accountId
      ? and(eq(registryCredentials.accountId, accountId), eq(registryCredentials.registry, 'ghcr.io'))
      : and(isNull(registryCredentials.accountId), eq(registryCredentials.registry, 'ghcr.io'));

    const existing = await db.query.registryCredentials.findFirst({ where: whereClause });

    if (existing) {
      await db.update(registryCredentials)
        .set({ username: ghUser.login, password: encrypt(token), updatedAt: new Date() })
        .where(eq(registryCredentials.id, existing.id));
      return c.json({ id: existing.id, registry: 'ghcr.io', username: ghUser.login }, 201);
    }

    const [cred] = await insertReturning(registryCredentials, {
      accountId,
      registry: 'ghcr.io',
      username: ghUser.login,
      password: encrypt(token),
    });

    return c.json({ id: cred!.id, registry: 'ghcr.io', username: ghUser.login }, 201);
  } catch (err) {
    clearTimeout(timeout);
    logger.error({ err }, 'Failed to validate GitHub token');
    return c.json({ error: 'Failed to validate GitHub token' }, 500);
  }
}

export default registryCredentialRoutes;
