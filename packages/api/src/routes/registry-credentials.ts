import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, registryCredentials, oauthProviders, insertReturning, eq, and } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { encrypt, decrypt } from '../services/crypto.service.js';
import { logger } from '../services/logger.js';
import { jsonBody, jsonContent, standardErrors, bearerSecurity } from './_schemas.js';

const registryCredentialRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

registryCredentialRoutes.use('*', authMiddleware);
registryCredentialRoutes.use('*', tenantMiddleware);

// GET / — List credentials for current account
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Registry Credentials'],
  summary: 'List registry credentials',
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
  middleware: [requireMember, requireScope('read')],
});

registryCredentialRoutes.openapi(listRoute, (async (c: any) => {
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

// POST / — Add a generic registry credential
const addRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Registry Credentials'],
  summary: 'Add a registry credential',
  security: bearerSecurity,
  request: {
    body: jsonBody(z.object({
      registry: z.string().min(1),
      username: z.string().min(1),
      password: z.string().min(1),
    })),
  },
  responses: {
    201: jsonContent(z.object({
      id: z.string(),
      registry: z.string(),
      username: z.string(),
    }), 'Credential created'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

registryCredentialRoutes.openapi(addRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { registry, username, password } = c.req.valid('json');

  // Check for existing credential for this registry
  const existing = await db.query.registryCredentials.findFirst({
    where: and(
      eq(registryCredentials.accountId, accountId),
      eq(registryCredentials.registry, registry),
    ),
  });

  if (existing) {
    // Update existing
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

// POST /github — Auto-connect GitHub Packages
const githubRoute = createRoute({
  method: 'post',
  path: '/github',
  tags: ['Registry Credentials'],
  summary: 'Connect GitHub Packages using linked GitHub account',
  security: bearerSecurity,
  responses: {
    201: jsonContent(z.object({
      id: z.string(),
      registry: z.string(),
      username: z.string(),
    }), 'GitHub Packages credential created'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

registryCredentialRoutes.openapi(githubRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user: AuthUser = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  // Find the user's GitHub OAuth link
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

  // Validate token has read:packages scope
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
    const existing = await db.query.registryCredentials.findFirst({
      where: and(
        eq(registryCredentials.accountId, accountId),
        eq(registryCredentials.registry, 'ghcr.io'),
      ),
    });

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
}) as any);

// DELETE /:id — Remove a credential
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Registry Credentials'],
  summary: 'Remove a registry credential',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string() }), 'Credential removed'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

registryCredentialRoutes.openapi(deleteRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const cred = await db.query.registryCredentials.findFirst({
    where: and(
      eq(registryCredentials.id, id),
      eq(registryCredentials.accountId, accountId),
    ),
  });

  if (!cred) return c.json({ error: 'Credential not found' }, 404);

  await db.delete(registryCredentials).where(eq(registryCredentials.id, id));

  return c.json({ message: 'Credential removed' });
}) as any);

export default registryCredentialRoutes;
