import crypto from 'node:crypto';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { hash, verify } from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { db, users, userAccounts, accounts, oauthProviders, insertReturning, safeTransaction, eq, and, isNull } from '@fleet/db';
import { rateLimiter } from '../middleware/rate-limit.js';
import { authMiddleware } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { encrypt, decrypt } from '../services/crypto.service.js';
import { emailService } from '../services/email.service.js';
import { getValkey } from '../services/valkey.service.js';
import { getGitHubConfig } from '../services/github.service.js';
import { getEmailQueue, isQueueAvailable } from '../services/queue.service.js';
import type { EmailJobData } from '../workers/email.worker.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { getAppUrl } from '../services/platform.service.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity, noSecurity } from './_schemas.js';

const auth = new OpenAPIHono();

const JWT_SECRET_KEY = () => {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
};

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const IMPERSONATION_REFRESH_EXPIRY = '1h'; // Shorter session for impersonation

export async function generateTokens(payload: { userId: string; email: string; isSuper: boolean; adminRoleId?: string; impersonatingAccountId?: string }) {
  const secret = JWT_SECRET_KEY();
  const isImpersonating = !!payload.impersonatingAccountId;

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
    .setExpirationTime(isImpersonating ? IMPERSONATION_REFRESH_EXPIRY : REFRESH_TOKEN_EXPIRY)
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
const authRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'auth' });
const passwordResetRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'reset' });
const twoFactorVerifyRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: '2fa-verify' });
const verifyEmailRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'verify-email' });
const resetPasswordRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'reset-password' });
const forgotPasswordRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'forgot-password' });
const refreshRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: 'refresh' });
const oauthRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'oauth' });
const twoFactorSetupRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: '2fa-setup' });
const resendVerificationRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 3, keyPrefix: 'resend-verify' });
const registerRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'register' });

/** Queue an email via BullMQ if available, otherwise send directly (fire-and-forget). */
async function queueEmail(data: EmailJobData): Promise<void> {
  if (isQueueAvailable()) {
    await getEmailQueue().add('send-email', data);
  } else {
    // Fallback: direct send for local dev without Valkey
    emailService.sendTemplateEmail(data.templateSlug, data.to, data.variables, data.accountId)
      .catch((err) => logger.error({ err }, `Failed to send ${data.templateSlug} email`));
  }
}

/** Generate a random token, return raw + SHA256 hash for storage. */
function generateSecureToken(): { raw: string; hashed: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hashed };
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function setRefreshTokenCookie(c: any, refreshToken: string) {
  setCookie(c, 'fleet_refresh', refreshToken, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

function clearRefreshTokenCookie(c: any) {
  deleteCookie(c, 'fleet_refresh', { path: '/' });
}

function userResponse(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuper: user.isSuper,
    adminRoleId: user.adminRoleId ?? null,
    emailVerified: user.emailVerified ?? false,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ── Schemas ──

const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128).refine(
    (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw),
    'Password must contain at least one lowercase letter, one uppercase letter, and one digit',
  ),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().optional(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

const twoFactorCodeSchema = z.object({
  code: z.string().min(1),
});

const twoFactorVerifySchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().min(1),
});

// ── Routes ──

// POST /register
const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  tags: ['Auth'],
  summary: 'Register a new user account',
  security: noSecurity,
  request: {
    body: jsonBody(registerSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Registration successful'),
    409: jsonContent(errorResponseSchema, 'User already exists'),
  },
  middleware: [authRateLimit, registerRateLimit],
});

auth.openapi(registerRoute, (async (c: any) => {
  const { name, email, password } = c.req.valid('json');

  // Check if user already exists
  const existing = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deletedAt)),
  });

  if (existing) {
    return c.json({ error: 'Registration failed. If you already have an account, try logging in.' }, 409);
  }

  // Hash password
  const passwordHash = await hash(password);

  // Generate email verification token
  const verifyToken = generateSecureToken();

  // Create user, account, and link them in a single transaction
  let user: any;
  let account: any;
  await safeTransaction(async (tx) => {
    [user] = await tx.insert(users).values({
      email,
      passwordHash,
      name,
      isSuper: false,
      emailVerified: false,
      emailVerifyToken: verifyToken.hashed,
      emailVerifyExpires: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4h
    }).returning();

    if (!user) {
      throw new Error('Failed to create user');
    }

    const slug = slugify(name) + '-' + user.id.slice(0, 8);
    [account] = await tx.insert(accounts).values({
      name: `${name}'s Account`,
      slug,
      parentId: null,
      path: slug,
      depth: 0,
      status: 'active',
    }).returning();

    if (account) {
      await tx.insert(userAccounts).values({
        userId: user.id,
        accountId: account.id,
        role: 'owner',
      });
    }
  });

  if (!user) {
    return c.json({ error: 'Failed to create user' }, 500);
  }

  // Send verification email AFTER transaction commits (queued with retry)
  const appUrl = await getAppUrl();
  queueEmail({
    templateSlug: 'email-verification',
    to: email,
    variables: {
      userName: name,
      verifyUrl: `${appUrl}/verify-email?token=${verifyToken.raw}`,
    },
  }).catch((err) => logger.error({ err }, 'Failed to queue verification email'));

  // Generate tokens
  const tokens = await generateTokens({
    userId: user.id,
    email: user.email!,
    isSuper: user.isSuper ?? false,
  });

  setRefreshTokenCookie(c, tokens.refreshToken);

  eventService.log({
    userId: user.id,
    actorEmail: user.email,
    eventType: EventTypes.USER_REGISTERED,
    description: `User registered`,
    resourceType: 'user',
    resourceId: user.id,
    resourceName: user.email,
  });

  return c.json({
    tokens,
    user: userResponse(user),
  }, 201);
}) as any);

// POST /login
const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Auth'],
  summary: 'Log in with email and password',
  security: noSecurity,
  request: {
    body: jsonBody(loginSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Login successful or 2FA challenge required'),
  },
  middleware: [authRateLimit],
});

auth.openapi(loginRoute, (async (c: any) => {
  const { email, password } = c.req.valid('json');

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deletedAt)),
  });

  const loginIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? undefined;

  if (!user || !user.passwordHash) {
    logger.warn({ email, ip: loginIp }, 'Failed login attempt — user not found');
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verify(user.passwordHash, password);
  if (!valid) {
    logger.warn({ userId: user.id, ip: loginIp }, 'Failed login attempt — wrong password');
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  // Check email verification
  if (!user.emailVerified) {
    return c.json({ error: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' }, 403);
  }

  // Check if password login is disabled for this user
  const disabledMethods: string[] = (user as any).disabledLoginMethods ?? [];
  if (disabledMethods.includes('password')) {
    return c.json({ error: 'Password login is disabled for this account. Use GitHub or Google to sign in.', code: 'LOGIN_METHOD_DISABLED' }, 403);
  }

  // Check 2FA
  if (user.twoFactorEnabled) {
    // Generate a short-lived temp token for 2FA flow
    const secret = JWT_SECRET_KEY();
    const tempToken = await new SignJWT({ userId: user.id, type: '2fa-challenge' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);

    return c.json({ requiresTwoFactor: true, tempToken });
  }

  const tokens = await generateTokens({
    userId: user.id,
    email: user.email!,
    isSuper: user.isSuper ?? false,
    adminRoleId: (user as any).adminRoleId ?? undefined,
  });

  setRefreshTokenCookie(c, tokens.refreshToken);

  eventService.log({
    userId: user.id,
    actorEmail: user.email,
    ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? undefined,
    eventType: EventTypes.USER_LOGIN,
    description: `User logged in`,
    resourceType: 'user',
    resourceId: user.id,
    resourceName: user.email ?? undefined,
  });

  return c.json({
    tokens,
    user: userResponse(user),
  });
}) as any);

// POST /refresh
const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags: ['Auth'],
  summary: 'Refresh access token using refresh cookie',
  security: noSecurity,
  request: {},
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'New token pair'),
    503: jsonContent(errorResponseSchema, 'Service temporarily unavailable'),
  },
  middleware: [refreshRateLimit],
});

auth.openapi(refreshRoute, (async (c: any) => {
  const refreshToken = getCookie(c, 'fleet_refresh');
  if (!refreshToken) {
    return c.json({ error: 'Refresh token required' }, 400);
  }

  // Check if refresh token is blocklisted (was already rotated)
  try {
    const valkey = await getValkey();
    if (valkey) {
      const blocked = await valkey.get(`blocklist:${refreshToken}`);
      if (blocked) {
        return c.json({ error: 'Refresh token has been revoked' }, 401);
      }
    } else if (process.env['NODE_ENV'] === 'production') {
      // In production, failing to check the blocklist is a security risk — reject the refresh
      return c.json({ error: 'Service temporarily unavailable' }, 503);
    }
  } catch {
    if (process.env['NODE_ENV'] === 'production') {
      return c.json({ error: 'Service temporarily unavailable' }, 503);
    }
    // In dev, allow graceful degradation
  }

  try {
    const secret = JWT_SECRET_KEY();
    const { payload } = await jwtVerify(refreshToken, secret);

    if (payload['type'] !== 'refresh') {
      return c.json({ error: 'Invalid token type' }, 401);
    }

    const userId = payload['userId'] as string;

    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    // Check if the token was issued before a security change (password change, role toggle)
    if (user.securityChangedAt) {
      const iat = payload['iat'] as number | undefined;
      if (iat && iat < Math.floor(user.securityChangedAt.getTime() / 1000)) {
        return c.json({ error: 'Token invalidated — please log in again' }, 401);
      }
    }

    const impersonatingAccountId = payload['impersonatingAccountId'] as string | undefined;

    const tokens = await generateTokens({
      userId: user.id,
      email: user.email!,
      isSuper: user.isSuper ?? false,
      adminRoleId: (user as any).adminRoleId ?? undefined,
      impersonatingAccountId,
    });

    // Rotate: blocklist the old refresh token
    try {
      const valkey = await getValkey();
      if (valkey) {
        const oldExp = payload.exp;
        if (oldExp) {
          const ttl = oldExp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            await valkey.setex(`blocklist:${refreshToken}`, ttl, '1');
          }
        }
      } else if (process.env['NODE_ENV'] === 'production') {
        // In production, failing to blocklist is a security risk — reject the refresh
        logger.error('Valkey unavailable — cannot blocklist old refresh token');
        return c.json({ error: 'Service temporarily unavailable' }, 503);
      }
    } catch (err) {
      if (process.env['NODE_ENV'] === 'production') {
        logger.error({ err }, 'Failed to blocklist old refresh token');
        return c.json({ error: 'Service temporarily unavailable' }, 503);
      }
      // In dev, allow graceful degradation
    }

    setRefreshTokenCookie(c, tokens.refreshToken);

    return c.json({ tokens });
  } catch {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }
}) as any);

// POST /logout
const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Auth'],
  summary: 'Log out and revoke tokens',
  security: bearerSecurity,
  request: {},
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Logged out successfully'),
  },
  middleware: [authMiddleware],
});

auth.openapi(logoutRoute, (async (c: any) => {
  const valkey = await getValkey();

  // Blocklist the access token
  const authorization = c.req.header('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7);
    try {
      const secret = JWT_SECRET_KEY();
      const { payload } = await jwtVerify(token, secret);
      const exp = payload.exp;
      if (exp && valkey) {
        const ttl = exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await valkey.setex(`blocklist:${token}`, ttl, '1');
        }
      }
    } catch {
      // Token already invalid, that's fine
    }
  }

  // Blocklist the refresh token to prevent reuse after logout
  const refreshToken = getCookie(c, 'fleet_refresh');
  if (refreshToken && valkey) {
    try {
      const secret = JWT_SECRET_KEY();
      const { payload } = await jwtVerify(refreshToken, secret);
      const exp = payload.exp;
      if (exp) {
        const ttl = exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await valkey.setex(`blocklist:${refreshToken}`, ttl, '1');
        }
      }
    } catch {
      // Refresh token already invalid, that's fine
    }
  }

  clearRefreshTokenCookie(c);

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.USER_LOGOUT,
    description: `User logged out`,
    resourceType: 'user',
  });

  return c.json({ message: 'Logged out successfully' });
}) as any);

// GET /me
const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Auth'],
  summary: 'Get current authenticated user',
  security: bearerSecurity,
  request: {},
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Current user info'),
  },
  middleware: [authMiddleware],
});

auth.openapi(meRoute, (async (c: any) => {
  const authUser = c.get('user');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(userResponse(user));
}) as any);

// GET /me/accounts
const meAccountsRoute = createRoute({
  method: 'get',
  path: '/me/accounts',
  tags: ['Auth'],
  summary: 'List all accounts the current user has access to',
  security: bearerSecurity,
  request: {},
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'List of accounts with roles'),
  },
  middleware: [authMiddleware],
});

auth.openapi(meAccountsRoute, (async (c: any) => {
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
}) as any);

// --- Email Verification ---

// POST /verify-email
const verifyEmailRoute = createRoute({
  method: 'post',
  path: '/verify-email',
  tags: ['Auth'],
  summary: 'Verify email address with token',
  security: noSecurity,
  request: {
    body: jsonBody(verifyEmailSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Email verified'),
  },
  middleware: [verifyEmailRateLimit],
});

auth.openapi(verifyEmailRoute, (async (c: any) => {
  const { token } = c.req.valid('json');

  const hashed = hashToken(token);

  // Use transaction to prevent TOCTOU race (same pattern as reset-password)
  const result = await safeTransaction(async (tx) => {
    const user = await tx.query.users.findFirst({
      where: and(eq(users.emailVerifyToken, hashed), isNull(users.deletedAt)),
    });

    if (!user) return { error: 'Invalid or expired verification token' } as const;

    if (user.emailVerifyExpires && new Date(user.emailVerifyExpires) < new Date()) {
      return { error: 'Verification token has expired' } as const;
    }

    await tx.update(users).set({
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyExpires: null,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    return { success: true } as const;
  });

  if ('error' in result) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ message: 'Email verified successfully' });
}) as any);

// POST /resend-verification
const resendVerificationRoute = createRoute({
  method: 'post',
  path: '/resend-verification',
  tags: ['Auth'],
  summary: 'Resend email verification link',
  security: bearerSecurity,
  request: {},
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Verification email sent'),
  },
  middleware: [resendVerificationRateLimit, authMiddleware],
});

auth.openapi(resendVerificationRoute, (async (c: any) => {
  const authUser = c.get('user');
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  if (user.emailVerified) {
    return c.json({ error: 'Email is already verified' }, 400);
  }

  const verifyToken = generateSecureToken();
  await db.update(users).set({
    emailVerifyToken: verifyToken.hashed,
    emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
  }).where(eq(users.id, user.id));

  const appUrl = await getAppUrl();
  await queueEmail({
    templateSlug: 'email-verification',
    to: user.email!,
    variables: {
      userName: user.name ?? 'User',
      verifyUrl: `${appUrl}/verify-email?token=${verifyToken.raw}`,
    },
  });

  return c.json({ message: 'Verification email sent' });
}) as any);

// --- Password Reset ---

// POST /forgot-password
const forgotPasswordRoute = createRoute({
  method: 'post',
  path: '/forgot-password',
  tags: ['Auth'],
  summary: 'Request a password reset email',
  security: noSecurity,
  request: {
    body: jsonBody(forgotPasswordSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Reset email sent (if account exists)'),
  },
  middleware: [forgotPasswordRateLimit],
});

auth.openapi(forgotPasswordRoute, (async (c: any) => {
  const body = c.req.valid('json');
  const email = body?.email;

  // Always return 200 to prevent email enumeration
  if (!email || typeof email !== 'string') {
    return c.json({ message: 'If an account exists with that email, a password reset link will be sent.' });
  }

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deletedAt)),
  });

  if (user) {
    const resetToken = generateSecureToken();
    await db.update(users).set({
      passwordResetToken: resetToken.hashed,
      passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    const appUrl = await getAppUrl();
    queueEmail({
      templateSlug: 'password-reset',
      to: email,
      variables: {
        userName: user.name ?? 'User',
        resetUrl: `${appUrl}/reset-password?token=${resetToken.raw}`,
        expiresIn: '1 hour',
      },
    }).catch((err) => logger.error({ err }, 'Failed to queue password reset email'));
  }

  return c.json({ message: 'If an account exists with that email, a password reset link will be sent.' });
}) as any);

// POST /reset-password
const resetPasswordRoute = createRoute({
  method: 'post',
  path: '/reset-password',
  tags: ['Auth'],
  summary: 'Reset password using token from email',
  security: noSecurity,
  request: {
    body: jsonBody(resetPasswordSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Password reset successfully'),
  },
  middleware: [resetPasswordRateLimit],
});

auth.openapi(resetPasswordRoute, (async (c: any) => {
  const { token, password } = c.req.valid('json');

  if (password.length < 8 || password.length > 128) {
    return c.json({ error: 'Password must be between 8 and 128 characters' }, 400);
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return c.json({ error: 'Password must contain at least one lowercase letter, one uppercase letter, and one digit' }, 400);
  }

  const hashed = hashToken(token);
  const passwordHash = await hash(password);

  // Use transaction to prevent TOCTOU race on reset token
  const result = await safeTransaction(async (tx) => {
    const user = await tx.query.users.findFirst({
      where: and(eq(users.passwordResetToken, hashed), isNull(users.deletedAt)),
    });

    if (!user) {
      return { error: 'Invalid or expired reset token' } as const;
    }

    if (user.passwordResetExpires && new Date(user.passwordResetExpires) < new Date()) {
      return { error: 'Reset token has expired' } as const;
    }

    await tx.update(users).set({
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
      securityChangedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    return { ok: true } as const;
  });

  if ('error' in result) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ message: 'Password has been reset successfully' });
}) as any);

// --- Two-Factor Authentication (TOTP) ---

// POST /2fa/setup
const twoFactorSetupRoute = createRoute({
  method: 'post',
  path: '/2fa/setup',
  tags: ['Auth'],
  summary: 'Generate TOTP secret and QR code for 2FA setup',
  security: bearerSecurity,
  request: {},
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'TOTP secret, URI, and QR code'),
  },
  middleware: [twoFactorSetupRateLimit, authMiddleware],
});

auth.openapi(twoFactorSetupRoute, (async (c: any) => {
  const authUser = c.get('user');
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) return c.json({ error: 'User not found' }, 404);
  if (user.twoFactorEnabled) return c.json({ error: '2FA is already enabled' }, 400);

  const totp = new OTPAuth.TOTP({
    issuer: 'Fleet',
    label: user.email!,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });

  const otpauthUri = totp.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

  // Store encrypted secret temporarily in the user record
  await db.update(users).set({
    twoFactorSecret: encrypt(totp.secret.base32),
    updatedAt: new Date(),
  }).where(eq(users.id, user.id));

  return c.json({
    secret: totp.secret.base32,
    otpauthUri,
    qrCode: qrCodeDataUrl,
  });
}) as any);

// POST /2fa/enable
const twoFactorEnableRoute = createRoute({
  method: 'post',
  path: '/2fa/enable',
  tags: ['Auth'],
  summary: 'Verify TOTP code and enable 2FA',
  security: bearerSecurity,
  request: {
    body: jsonBody(twoFactorCodeSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Backup codes'),
  },
  middleware: [twoFactorSetupRateLimit, authMiddleware],
});

auth.openapi(twoFactorEnableRoute, (async (c: any) => {
  const authUser = c.get('user');
  const { code } = c.req.valid('json');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) return c.json({ error: 'User not found' }, 404);
  if (user.twoFactorEnabled) return c.json({ error: '2FA is already enabled' }, 400);
  if (!user.twoFactorSecret) return c.json({ error: 'Run 2FA setup first' }, 400);

  const secretBase32 = decrypt(user.twoFactorSecret);
  const totp = new OTPAuth.TOTP({
    issuer: 'Fleet',
    label: user.email!,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    return c.json({ error: 'Invalid verification code' }, 400);
  }

  // Generate backup codes
  const backupCodes = Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex'),
  );
  const hashedBackupCodes = await Promise.all(backupCodes.map((code) => hash(code)));

  await db.update(users).set({
    twoFactorEnabled: true,
    twoFactorBackupCodes: hashedBackupCodes,
    updatedAt: new Date(),
  }).where(eq(users.id, user.id));

  return c.json({ backupCodes });
}) as any);

// POST /2fa/disable
const twoFactorDisableRoute = createRoute({
  method: 'post',
  path: '/2fa/disable',
  tags: ['Auth'],
  summary: 'Disable 2FA with verification code',
  security: bearerSecurity,
  request: {
    body: jsonBody(twoFactorCodeSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, '2FA disabled'),
  },
  middleware: [twoFactorSetupRateLimit, authMiddleware],
});

auth.openapi(twoFactorDisableRoute, (async (c: any) => {
  const authUser = c.get('user');
  const { code } = c.req.valid('json');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) return c.json({ error: 'User not found' }, 404);
  if (!user.twoFactorEnabled) return c.json({ error: '2FA is not enabled' }, 400);

  // Verify TOTP code or backup code
  let verified = false;
  let usedBackupCodeIndex = -1;
  if (user.twoFactorSecret) {
    const secretBase32 = decrypt(user.twoFactorSecret);
    const totp = new OTPAuth.TOTP({
      issuer: 'Fleet',
      label: user.email!,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    if (totp.validate({ token: code, window: 1 }) !== null) {
      verified = true;
    }
  }

  if (!verified) {
    // Check backup codes
    const backupCodes = (user.twoFactorBackupCodes as string[] | null) ?? [];
    for (let i = 0; i < backupCodes.length; i++) {
      try {
        if (await verify(backupCodes[i]!, code)) {
          verified = true;
          usedBackupCodeIndex = i;
          break;
        }
      } catch {
        // skip invalid hash
      }
    }
  }

  if (!verified) {
    return c.json({ error: 'Invalid verification code' }, 400);
  }

  // Disable 2FA atomically — wipe secret and backup codes, invalidate sessions
  await safeTransaction(async (tx) => {
    await tx.update(users).set({
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      securityChangedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));
  });

  return c.json({ message: '2FA has been disabled' });
}) as any);

// POST /2fa/verify — verify 2FA during login flow
const twoFactorVerifyRoute = createRoute({
  method: 'post',
  path: '/2fa/verify',
  tags: ['Auth'],
  summary: 'Verify 2FA code during login flow',
  security: noSecurity,
  request: {
    body: jsonBody(twoFactorVerifySchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Login tokens and user'),
  },
  middleware: [twoFactorVerifyRateLimit],
});

auth.openapi(twoFactorVerifyRoute, (async (c: any) => {
  const { tempToken, code } = c.req.valid('json');

  // Verify temp token
  let userId: string;
  try {
    const secret = JWT_SECRET_KEY();
    const { payload } = await jwtVerify(tempToken, secret);
    if (payload['type'] !== '2fa-challenge') {
      return c.json({ error: 'Invalid token' }, 401);
    }
    userId = payload['userId'] as string;
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), isNull(users.deletedAt)),
  });

  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  // Try TOTP verification
  let verified = false;
  const secretBase32 = decrypt(user.twoFactorSecret);
  const totp = new OTPAuth.TOTP({
    issuer: 'Fleet',
    label: user.email!,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });

  if (totp.validate({ token: code, window: 1 }) !== null) {
    verified = true;
  }

  // Try backup codes (use transaction to prevent double-spend race condition)
  if (!verified) {
    const backupCodes = (user.twoFactorBackupCodes as string[] | null) ?? [];
    for (let i = 0; i < backupCodes.length; i++) {
      try {
        if (await verify(backupCodes[i]!, code)) {
          verified = true;
          // Consume backup code atomically
          await safeTransaction(async (tx) => {
            const freshUser = await tx.query.users.findFirst({
              where: eq(users.id, user.id),
            });
            const freshCodes = (freshUser?.twoFactorBackupCodes as string[] | null) ?? [];
            const idx = freshCodes.indexOf(backupCodes[i]!);
            if (idx !== -1) {
              const remaining = [...freshCodes];
              remaining.splice(idx, 1);
              await tx.update(users).set({
                twoFactorBackupCodes: remaining,
                updatedAt: new Date(),
              }).where(eq(users.id, user.id));
            }
          });
          break;
        }
      } catch {
        // skip invalid hash
      }
    }
  }

  if (!verified) {
    return c.json({ error: 'Invalid verification code' }, 400);
  }

  const tokens = await generateTokens({
    userId: user.id,
    email: user.email!,
    isSuper: user.isSuper ?? false,
    adminRoleId: (user as any).adminRoleId ?? undefined,
  });

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({ tokens, user: userResponse(user) });
}) as any);

// --- OAuth Routes ---
// OAuth redirect endpoints use plain .get() since they return c.redirect() — NOT REST endpoints

// GET /github — redirect to GitHub OAuth
auth.get('/github', oauthRateLimit, async (c) => {
  const ghConfig = await getGitHubConfig();
  const clientId = ghConfig.clientId;
  if (!clientId) {
    return c.json({ error: 'GitHub OAuth is not configured' }, 500);
  }

  const returnTo = c.req.query('returnTo') || '';
  const redirectUri = `${await getAppUrl()}/api/v1/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'user:email repo read:packages',
  });

  // If user is already logged in (has valid refresh cookie), store their userId
  // so the callback can link the OAuth provider to their existing account
  let linkToUserId: string | undefined;
  const refreshToken = getCookie(c, 'fleet_refresh');
  if (refreshToken && returnTo.startsWith('/panel/profile')) {
    try {
      const secret = JWT_SECRET_KEY();
      const { payload } = await jwtVerify(refreshToken, secret);
      if (payload['type'] === 'refresh' && payload['userId']) {
        linkToUserId = payload['userId'] as string;
      }
    } catch {
      // Invalid token — proceed as normal login flow
    }
  }

  // Generate a random nonce and store state in Valkey for CSRF protection
  const nonce = crypto.randomBytes(16).toString('hex');
  try {
    const valkey = await getValkey();
    if (!valkey) {
      return c.redirect('/auth/callback?error=OAuth+state+storage+unavailable');
    }
    await valkey.setex(`oauth:state:${nonce}`, 300, JSON.stringify({ returnTo, linkToUserId }));
    params.set('state', nonce);
  } catch {
    return c.redirect('/auth/callback?error=OAuth+state+storage+unavailable');
  }

  return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// GET /github/callback
auth.get('/github/callback', oauthRateLimit, async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state') || '';

  // Verify state nonce from Valkey for CSRF protection, then extract returnTo
  let returnTo = '';
  let linkToUserId: string | undefined;
  if (!stateParam) {
    return c.redirect('/auth/callback?error=Invalid+OAuth+state');
  }
  try {
    const valkey = await getValkey();
    if (!valkey) {
      return c.redirect('/auth/callback?error=OAuth+state+verification+unavailable');
    }
    const stored = await valkey.get(`oauth:state:${stateParam}`);
    if (!stored) {
      return c.redirect('/auth/callback?error=Invalid+OAuth+state');
    }
    await valkey.del(`oauth:state:${stateParam}`);
    const parsed = JSON.parse(stored);
    returnTo = parsed.returnTo || '';
    linkToUserId = parsed.linkToUserId;
  } catch {
    return c.redirect('/auth/callback?error=OAuth+state+verification+unavailable');
  }

  // Validate returnTo is a safe relative path (prevent open redirect)
  if (returnTo && (!returnTo.startsWith('/') || returnTo.startsWith('//'))) {
    returnTo = '';
  }

  if (!code) {
    return c.redirect('/auth/callback?error=Missing+authorization+code');
  }

  const ghConfig = await getGitHubConfig();
  const clientId = ghConfig.clientId;
  const clientSecret = ghConfig.clientSecret;
  if (!clientId || !clientSecret) {
    return c.redirect('/auth/callback?error=GitHub+OAuth+not+configured');
  }

  try {
    // Exchange code for access token
    const ghTokenController = new AbortController();
    const ghTokenTimeout = setTimeout(() => ghTokenController.abort(), 10_000);
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
      signal: ghTokenController.signal,
    });
    clearTimeout(ghTokenTimeout);

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      return c.redirect('/auth/callback?error=Failed+to+get+access+token');
    }

    // Fetch GitHub user profile
    const ghUserController = new AbortController();
    const ghUserTimeout = setTimeout(() => ghUserController.abort(), 10_000);
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: ghUserController.signal,
    });
    clearTimeout(ghUserTimeout);
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
      const ghEmailsController = new AbortController();
      const ghEmailsTimeout = setTimeout(() => ghEmailsController.abort(), 10_000);
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: ghEmailsController.signal,
      });
      clearTimeout(ghEmailsTimeout);
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

    // Profile linking flow — user is already logged in and wants to connect GitHub
    if (linkToUserId) {
      const existingLink = await db.query.oauthProviders.findFirst({
        where: (op, { and, eq }) =>
          and(eq(op.provider, 'github'), eq(op.providerUserId, providerUserId)),
      });

      if (existingLink && existingLink.userId !== linkToUserId) {
        return c.redirect(`${returnTo || '/panel/profile'}#error=This+GitHub+account+is+linked+to+another+user`);
      }

      if (existingLink) {
        // Already linked to this user — just update token
        await db.update(oauthProviders)
          .set({ accessToken: encrypt(tokenData.access_token!) })
          .where(eq(oauthProviders.id, existingLink.id));
      } else {
        await db.insert(oauthProviders).values({
          userId: linkToUserId,
          provider: 'github',
          providerUserId,
          accessToken: encrypt(tokenData.access_token!),
        });
      }

      return c.redirect(`${returnTo || '/panel/profile'}#connected=github`);
    }

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
        where: and(eq(users.email, email), isNull(users.deletedAt)),
      });

      if (!user) {
        // Create new user, account, and link in a single transaction (OAuth = email already verified)
        await safeTransaction(async (tx) => {
          const [newUser] = await tx.insert(users).values({
            email,
            name: githubUser.name ?? githubUser.login,
            avatarUrl: githubUser.avatar_url,
            isSuper: false,
            emailVerified: true,
          }).returning();
          if (!newUser) throw new Error('Failed to create user');
          user = newUser;

          const slug = slugify(newUser.name ?? newUser.email!) + '-' + newUser.id.slice(0, 8);
          const [account] = await tx.insert(accounts).values({
            name: `${newUser.name ?? newUser.email}'s Account`,
            slug,
            path: slug,
            depth: 0,
            status: 'active',
          }).returning();

          if (account) {
            await tx.insert(userAccounts).values({
              userId: newUser.id,
              accountId: account.id,
              role: 'owner',
            });
          }

          // Link OAuth provider within the same transaction
          await tx.insert(oauthProviders).values({
            userId: newUser.id,
            provider: 'github',
            providerUserId,
            accessToken: encrypt(tokenData.access_token!),
          });
        });
      } else {
        // Only link OAuth to existing accounts with verified email to prevent account takeover
        if (!user!.emailVerified) {
          return c.redirect('/auth/callback?error=Email+not+verified.+Please+verify+your+email+first+then+link+your+account.');
        }
        // Link OAuth provider to existing verified user
        await db.insert(oauthProviders).values({
          userId: user!.id,
          provider: 'github',
          providerUserId,
          accessToken: encrypt(tokenData.access_token),
        });
      }

      userId = user!.id;
    }

    // Fetch full user for token
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
    });

    if (!user) {
      return c.redirect('/auth/callback?error=User+not+found');
    }

    // Check if GitHub login is disabled for this user
    const ghDisabledMethods: string[] = (user as any).disabledLoginMethods ?? [];
    if (ghDisabledMethods.includes('github')) {
      return c.redirect('/auth/callback?error=GitHub+login+is+disabled+for+this+account');
    }

    // 2FA check — if user has 2FA enabled, redirect to 2FA challenge
    if (user.twoFactorEnabled) {
      const secret = JWT_SECRET_KEY();
      const tempToken = await new SignJWT({ userId: user.id, type: '2fa-challenge' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(secret);
      return c.redirect(`/auth/2fa?tempToken=${encodeURIComponent(tempToken)}`);
    }

    const tokens = await generateTokens({
      userId: user.id,
      email: user.email!,
      isSuper: user.isSuper ?? false,
      adminRoleId: (user as any).adminRoleId ?? undefined,
    });

    setRefreshTokenCookie(c, tokens.refreshToken);

    // Use fragment (#) instead of query params (?) to keep tokens out of server logs,
    // browser history, and Referer headers. Fragments are never sent to the server.
    if (returnTo) {
      return c.redirect(
        `${returnTo}#github_connected=true&token=${tokens.accessToken}`,
      );
    }

    return c.redirect(
      `/auth/callback#token=${tokens.accessToken}`,
    );
  } catch (err) {
    logger.error({ err }, 'GitHub OAuth error');
    return c.redirect('/auth/callback?error=OAuth+authentication+failed');
  }
});

// GET /google — redirect to Google OAuth
auth.get('/google', oauthRateLimit, async (c) => {
  const { getGoogleConfig } = await import('../services/google.service.js');
  const googleConfig = await getGoogleConfig();
  const clientId = googleConfig.clientId;
  if (!clientId) {
    return c.json({ error: 'Google OAuth is not configured' }, 500);
  }

  const returnTo = c.req.query('returnTo') || '';
  const redirectUri = `${await getAppUrl()}/api/v1/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
  });

  // If user is already logged in (has valid refresh cookie), store their userId
  // so the callback can link the OAuth provider to their existing account
  let linkToUserId: string | undefined;
  const refreshToken = getCookie(c, 'fleet_refresh');
  if (refreshToken && returnTo.startsWith('/panel/profile')) {
    try {
      const secret = JWT_SECRET_KEY();
      const { payload } = await jwtVerify(refreshToken, secret);
      if (payload['type'] === 'refresh' && payload['userId']) {
        linkToUserId = payload['userId'] as string;
      }
    } catch {
      // Invalid token — proceed as normal login flow
    }
  }

  // Generate a random nonce and store in Valkey for CSRF protection
  const nonce = crypto.randomBytes(16).toString('hex');
  try {
    const valkey = await getValkey();
    if (!valkey) {
      return c.redirect('/auth/callback?error=OAuth+state+storage+unavailable');
    }
    await valkey.setex(`oauth:state:${nonce}`, 300, JSON.stringify({ provider: 'google', returnTo, linkToUserId }));
    params.set('state', nonce);
  } catch {
    return c.redirect('/auth/callback?error=OAuth+state+storage+unavailable');
  }

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// GET /google/callback
auth.get('/google/callback', oauthRateLimit, async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state') || '';

  // Verify state nonce from Valkey for CSRF protection (required)
  let returnTo = '';
  let linkToUserId: string | undefined;
  if (!stateParam) {
    return c.redirect('/auth/callback?error=Invalid+OAuth+state');
  }
  try {
    const valkey = await getValkey();
    if (!valkey) {
      return c.redirect('/auth/callback?error=OAuth+state+verification+unavailable');
    }
    const stored = await valkey.get(`oauth:state:${stateParam}`);
    if (!stored) {
      return c.redirect('/auth/callback?error=Invalid+OAuth+state');
    }
    await valkey.del(`oauth:state:${stateParam}`);
    const parsed = JSON.parse(stored);
    returnTo = parsed.returnTo || '';
    linkToUserId = parsed.linkToUserId;
  } catch {
    return c.redirect('/auth/callback?error=OAuth+state+verification+unavailable');
  }

  // Validate returnTo is a safe relative path (prevent open redirect)
  if (returnTo && (!returnTo.startsWith('/') || returnTo.startsWith('//'))) {
    returnTo = '';
  }

  if (!code) {
    return c.redirect('/auth/callback?error=Missing+authorization+code');
  }

  const { getGoogleConfig } = await import('../services/google.service.js');
  const googleConfig = await getGoogleConfig();
  const clientId = googleConfig.clientId;
  const clientSecret = googleConfig.clientSecret;
  if (!clientId || !clientSecret) {
    return c.redirect('/auth/callback?error=Google+OAuth+not+configured');
  }

  try {
    const redirectUri = `${await getAppUrl()}/api/v1/auth/google/callback`;

    // Exchange code for tokens
    const googleTokenController = new AbortController();
    const googleTokenTimeout = setTimeout(() => googleTokenController.abort(), 10_000);
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
      signal: googleTokenController.signal,
    });
    clearTimeout(googleTokenTimeout);

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      return c.redirect('/auth/callback?error=Failed+to+get+access+token');
    }

    // Fetch Google user info
    const googleUserController = new AbortController();
    const googleUserTimeout = setTimeout(() => googleUserController.abort(), 10_000);
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: googleUserController.signal,
    });
    clearTimeout(googleUserTimeout);
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

    // Profile linking flow — user is already logged in and wants to connect Google
    if (linkToUserId) {
      const existingLink = await db.query.oauthProviders.findFirst({
        where: (op, { and, eq }) =>
          and(eq(op.provider, 'google'), eq(op.providerUserId, providerUserId)),
      });

      if (existingLink && existingLink.userId !== linkToUserId) {
        return c.redirect(`${returnTo || '/panel/profile'}#error=This+Google+account+is+linked+to+another+user`);
      }

      if (existingLink) {
        await db.update(oauthProviders)
          .set({ accessToken: encrypt(tokenData.access_token!) })
          .where(eq(oauthProviders.id, existingLink.id));
      } else {
        await db.insert(oauthProviders).values({
          userId: linkToUserId,
          provider: 'google',
          providerUserId,
          accessToken: encrypt(tokenData.access_token!),
        });
      }

      return c.redirect(`${returnTo || '/panel/profile'}#connected=google`);
    }

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
        where: and(eq(users.email, googleUser.email), isNull(users.deletedAt)),
      });

      if (!user) {
        // Create new user, account, and link in a single transaction
        await safeTransaction(async (tx) => {
          const [newUser] = await tx.insert(users).values({
            email: googleUser.email,
            name: googleUser.name,
            avatarUrl: googleUser.picture,
            isSuper: false,
            emailVerified: true,
          }).returning();
          if (!newUser) throw new Error('Failed to create user');
          user = newUser;

          const slug = slugify(newUser.name ?? newUser.email!) + '-' + newUser.id.slice(0, 8);
          const [account] = await tx.insert(accounts).values({
            name: `${newUser.name ?? newUser.email}'s Account`,
            slug,
            path: slug,
            depth: 0,
            status: 'active',
          }).returning();

          if (account) {
            await tx.insert(userAccounts).values({
              userId: newUser.id,
              accountId: account.id,
              role: 'owner',
            });
          }

          // Link OAuth provider within the same transaction
          await tx.insert(oauthProviders).values({
            userId: newUser.id,
            provider: 'google',
            providerUserId,
            accessToken: encrypt(tokenData.access_token!),
          });
        });
      } else {
        // Only link OAuth to existing accounts with verified email to prevent account takeover
        if (!user!.emailVerified) {
          return c.redirect('/auth/callback?error=Email+not+verified.+Please+verify+your+email+first+then+link+your+account.');
        }
        // Link OAuth provider to existing verified user
        await db.insert(oauthProviders).values({
          userId: user!.id,
          provider: 'google',
          providerUserId,
          accessToken: encrypt(tokenData.access_token),
        });
      }

      userId = user!.id;
    }

    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
    });

    if (!user) {
      return c.redirect('/auth/callback?error=User+not+found');
    }

    // Check if Google login is disabled for this user
    const googleDisabledMethods: string[] = (user as any).disabledLoginMethods ?? [];
    if (googleDisabledMethods.includes('google')) {
      return c.redirect('/auth/callback?error=Google+login+is+disabled+for+this+account');
    }

    // 2FA check — if user has 2FA enabled, redirect to 2FA challenge
    if (user.twoFactorEnabled) {
      const secret = JWT_SECRET_KEY();
      const tempToken = await new SignJWT({ userId: user.id, type: '2fa-challenge' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(secret);
      return c.redirect(`/auth/2fa?tempToken=${encodeURIComponent(tempToken)}`);
    }

    const tokens = await generateTokens({
      userId: user.id,
      email: user.email!,
      isSuper: user.isSuper ?? false,
      adminRoleId: (user as any).adminRoleId ?? undefined,
    });

    setRefreshTokenCookie(c, tokens.refreshToken);

    return c.redirect(
      `/auth/callback#token=${tokens.accessToken}`,
    );
  } catch (err) {
    logger.error({ err }, 'Google OAuth error');
    return c.redirect('/auth/callback?error=OAuth+authentication+failed');
  }
});

export default auth;
