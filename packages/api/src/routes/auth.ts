import { Hono } from 'hono';
import { z } from 'zod';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { db, users, userAccounts, accounts, oauthProviders, insertReturning, eq } from '@fleet/db';
import { rateLimiter } from '../middleware/rate-limit.js';
import { authMiddleware } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { encrypt } from '../services/crypto.service.js';

const auth = new Hono();

const JWT_SECRET_KEY = () => {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
};

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export async function generateTokens(payload: { userId: string; email: string; isSuper: boolean; impersonatingAccountId?: string }) {
  const secret = JWT_SECRET_KEY();

  const accessToken = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret);

  const refreshPayload: Record<string, unknown> = { userId: payload.userId, type: 'refresh' };
  if (payload.impersonatingAccountId) {
    refreshPayload.impersonatingAccountId = payload.impersonatingAccountId;
  }

  const refreshToken = await new SignJWT(refreshPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(secret);

  return { accessToken, refreshToken };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Rate limit auth endpoints
const authRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

// POST /register
const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

auth.post('/register', authRateLimit, async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { name, email, password } = parsed.data;

  // Check if user already exists
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existing) {
    return c.json({ error: 'An account with this email already exists' }, 409);
  }

  // Hash password
  const passwordHash = await hash(password);

  // Create user
  const [user] = await insertReturning(users, {
    email,
    passwordHash,
    name,
    isSuper: false,
  });

  if (!user) {
    return c.json({ error: 'Failed to create user' }, 500);
  }

  // Create a personal account for the user
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
    // Link user to account as owner
    await db.insert(userAccounts).values({
      userId: user.id,
      accountId: account.id,
      role: 'owner',
    });
  }

  // Generate tokens
  const tokens = await generateTokens({
    userId: user.id,
    email: user.email!,
    isSuper: user.isSuper ?? false,
  });

  return c.json({
    tokens,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isSuper: user.isSuper,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  }, 201);
});

// POST /login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

auth.post('/login', authRateLimit, async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid email or password' }, 400);
  }

  const { email, password } = parsed.data;

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user || !user.passwordHash) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verify(user.passwordHash, password);
  if (!valid) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const tokens = await generateTokens({
    userId: user.id,
    email: user.email!,
    isSuper: user.isSuper ?? false,
  });

  return c.json({
    tokens,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isSuper: user.isSuper,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

// POST /refresh
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

auth.post('/refresh', async (c) => {
  const body = await c.req.json();
  const parsed = refreshSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Refresh token is required' }, 400);
  }

  try {
    const secret = JWT_SECRET_KEY();
    const { payload } = await jwtVerify(parsed.data.refreshToken, secret);

    if (payload['type'] !== 'refresh') {
      return c.json({ error: 'Invalid token type' }, 401);
    }

    const userId = payload['userId'] as string;

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    const impersonatingAccountId = payload['impersonatingAccountId'] as string | undefined;

    const tokens = await generateTokens({
      userId: user.id,
      email: user.email!,
      isSuper: user.isSuper ?? false,
      impersonatingAccountId,
    });

    return c.json({ tokens });
  } catch {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }
});

// POST /logout
auth.post('/logout', (c) => {
  // JWT-based auth is stateless — client just discards tokens.
  // In a production system, you'd add the token to a blocklist in Valkey.
  return c.json({ message: 'Logged out successfully' });
});

// GET /me — requires auth
auth.get('/me', authMiddleware, async (c) => {
  const authUser = c.get('user');

  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.userId),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuper: user.isSuper,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
});

// GET /me/accounts — list all accounts user has access to
auth.get('/me/accounts', authMiddleware, async (c) => {
  const authUser = c.get('user');

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, authUser.userId),
    with: { account: true },
  });

  const result = memberships.map((m) => ({
    ...m.account,
    role: m.role,
  }));

  return c.json(result);
});

// --- OAuth Routes ---

// GET /github — redirect to GitHub OAuth
auth.get('/github', (c) => {
  const clientId = process.env['GITHUB_CLIENT_ID'];
  if (!clientId) {
    return c.json({ error: 'GitHub OAuth is not configured' }, 500);
  }

  const redirectUri = `${process.env['APP_URL'] ?? 'http://localhost:3000'}/api/v1/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email`;

  return c.redirect(url);
});

// GET /github/callback
auth.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.redirect('/auth/callback?error=Missing+authorization+code');
  }

  const clientId = process.env['GITHUB_CLIENT_ID'];
  const clientSecret = process.env['GITHUB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    return c.redirect('/auth/callback?error=GitHub+OAuth+not+configured');
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      return c.redirect('/auth/callback?error=Failed+to+get+access+token');
    }

    // Fetch GitHub user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const githubUser = (await userRes.json()) as {
      id: number;
      login: string;
      name: string | null;
      email: string | null;
      avatar_url: string;
    };

    // Fetch primary email if not public
    let email = githubUser.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified);
      email = primary?.email ?? emails[0]?.email ?? null;
    }

    if (!email) {
      return c.redirect('/auth/callback?error=No+email+found+on+GitHub+account');
    }

    const providerUserId = String(githubUser.id);

    // Check if OAuth link exists
    const existingOAuth = await db.query.oauthProviders.findFirst({
      where: (op, { and, eq }) =>
        and(eq(op.provider, 'github'), eq(op.providerUserId, providerUserId)),
    });

    let userId: string;

    if (existingOAuth) {
      // User already linked — just log them in
      userId = existingOAuth.userId;
      // Update access token
      await db
        .update(oauthProviders)
        .set({ accessToken: encrypt(tokenData.access_token) })
        .where(eq(oauthProviders.id, existingOAuth.id));
    } else {
      // Check if a user with this email exists
      let user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user) {
        // Create new user
        const [newUser] = await insertReturning(users, {
          email,
          name: githubUser.name ?? githubUser.login,
          avatarUrl: githubUser.avatar_url,
          isSuper: false,
        });
        if (!newUser) throw new Error('Failed to create user');
        user = newUser;

        // Create personal account
        const slug = slugify(newUser.name ?? newUser.email!) + '-' + newUser.id.slice(0, 8);
        const [account] = await insertReturning(accounts, {
          name: `${newUser.name ?? newUser.email}'s Account`,
          slug,
          path: slug,
          depth: 0,
          status: 'active',
        });

        if (account) {
          await db.insert(userAccounts).values({
            userId: newUser.id,
            accountId: account.id,
            role: 'owner',
          });
        }
      }

      userId = user!.id;

      // Link OAuth provider
      await db.insert(oauthProviders).values({
        userId,
        provider: 'github',
        providerUserId,
        accessToken: encrypt(tokenData.access_token),
      });
    }

    // Fetch full user for token
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return c.redirect('/auth/callback?error=User+not+found');
    }

    const tokens = await generateTokens({
      userId: user.id,
      email: user.email!,
      isSuper: user.isSuper ?? false,
    });

    return c.redirect(
      `/auth/callback?token=${tokens.accessToken}&refresh_token=${tokens.refreshToken}`,
    );
  } catch (err) {
    logger.error({ err }, 'GitHub OAuth error');
    return c.redirect('/auth/callback?error=OAuth+authentication+failed');
  }
});

// GET /google — redirect to Google OAuth
auth.get('/google', (c) => {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  if (!clientId) {
    return c.json({ error: 'Google OAuth is not configured' }, 500);
  }

  const redirectUri = `${process.env['APP_URL'] ?? 'http://localhost:3000'}/api/v1/auth/google/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid+email+profile`;

  return c.redirect(url);
});

// GET /google/callback
auth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.redirect('/auth/callback?error=Missing+authorization+code');
  }

  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    return c.redirect('/auth/callback?error=Google+OAuth+not+configured');
  }

  try {
    const redirectUri = `${process.env['APP_URL'] ?? 'http://localhost:3000'}/api/v1/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      return c.redirect('/auth/callback?error=Failed+to+get+access+token');
    }

    // Fetch Google user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = (await userRes.json()) as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

    if (!googleUser.email) {
      return c.redirect('/auth/callback?error=No+email+found+on+Google+account');
    }

    const providerUserId = googleUser.id;

    // Check if OAuth link exists
    const existingOAuth = await db.query.oauthProviders.findFirst({
      where: (op, { and, eq }) =>
        and(eq(op.provider, 'google'), eq(op.providerUserId, providerUserId)),
    });

    let userId: string;

    if (existingOAuth) {
      userId = existingOAuth.userId;
      await db
        .update(oauthProviders)
        .set({ accessToken: encrypt(tokenData.access_token) })
        .where(eq(oauthProviders.id, existingOAuth.id));
    } else {
      let user = await db.query.users.findFirst({
        where: eq(users.email, googleUser.email),
      });

      if (!user) {
        const [newUser] = await insertReturning(users, {
          email: googleUser.email,
          name: googleUser.name,
          avatarUrl: googleUser.picture,
          isSuper: false,
        });
        if (!newUser) throw new Error('Failed to create user');
        user = newUser;

        const slug = slugify(newUser.name ?? newUser.email!) + '-' + newUser.id.slice(0, 8);
        const [account] = await insertReturning(accounts, {
          name: `${newUser.name ?? newUser.email}'s Account`,
          slug,
          path: slug,
          depth: 0,
          status: 'active',
        });

        if (account) {
          await db.insert(userAccounts).values({
            userId: newUser.id,
            accountId: account.id,
            role: 'owner',
          });
        }
      }

      userId = user!.id;

      await db.insert(oauthProviders).values({
        userId,
        provider: 'google',
        providerUserId,
        accessToken: encrypt(tokenData.access_token),
      });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return c.redirect('/auth/callback?error=User+not+found');
    }

    const tokens = await generateTokens({
      userId: user.id,
      email: user.email!,
      isSuper: user.isSuper ?? false,
    });

    return c.redirect(
      `/auth/callback?token=${tokens.accessToken}&refresh_token=${tokens.refreshToken}`,
    );
  } catch (err) {
    logger.error({ err }, 'Google OAuth error');
    return c.redirect('/auth/callback?error=OAuth+authentication+failed');
  }
});

export default auth;
