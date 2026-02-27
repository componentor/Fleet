import crypto from 'node:crypto';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { hash, verify } from 'argon2';
import { deleteCookie } from 'hono/cookie';
import { db, users, userAccounts, accounts, oauthProviders, services, deployments, sshKeys, apiKeys, auditLog, dnsZones, updateReturning, safeTransaction, eq, and, isNull, like } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { getValkey } from '../services/valkey.service.js';
import { getEmailQueue, isQueueAvailable } from '../services/queue.service.js';
import { emailService } from '../services/email.service.js';
import { logger } from '../services/logger.js';
import { dockerService } from '../services/docker.service.js';
import { storageManager } from '../services/storage/storage-manager.js';
import { STORAGE_BUCKETS } from '../services/storage/storage-provider.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity, noSecurity } from './_schemas.js';
import type { EmailJobData } from '../workers/email.worker.js';

const userRoutes = new OpenAPIHono<{
  Variables: { user: AuthUser };
}>();

// Public routes (no auth required) — mounted separately
export const userPublicRoutes = new OpenAPIHono();

userRoutes.use('*', authMiddleware);

// ── Helpers ──

async function queueEmail(data: EmailJobData): Promise<void> {
  if (isQueueAvailable()) {
    await getEmailQueue().add('send-email', data);
  } else {
    emailService.sendTemplateEmail(data.templateSlug, data.to, data.variables, data.accountId)
      .catch((err) => logger.error({ err }, `Failed to send ${data.templateSlug} email`));
  }
}

function generateSecureToken(): { raw: string; hashed: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hashed };
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function userProfileResponse(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuper: user.isSuper,
    hasPassword: !!user.passwordHash,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

const deleteRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'user-delete' });
const emailChangeRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'email-change' });

// ── Schemas ──

const userProfileSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isSuper: z.boolean().nullable(),
  hasPassword: z.boolean().optional(),
  createdAt: z.any(),
  updatedAt: z.any(),
}).openapi('UserProfile');

const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
}).openapi('UpdateProfileRequest');

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
}).openapi('ChangePasswordRequest');

const changeEmailSchema = z.object({
  newEmail: z.string().email().max(255),
  password: z.string().min(1),
}).openapi('ChangeEmailRequest');

const verifyEmailChangeSchema = z.object({
  token: z.string().min(1),
}).openapi('VerifyEmailChangeRequest');

const deleteUserSchema = z.object({
  password: z.string().optional(),
  emailCode: z.string().optional(),
}).openapi('DeleteUserRequest');

const accountWithRoleSchema = z.any().openapi('AccountWithRole');

// ── Route definitions ──

const getMeRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Users'],
  summary: 'Get current user profile',
  security: bearerSecurity,
  responses: {
    200: jsonContent(userProfileSchema, 'Current user profile'),
    ...standardErrors,
  },
});

const updateMeRoute = createRoute({
  method: 'patch',
  path: '/me',
  tags: ['Users'],
  summary: 'Update current user profile',
  security: bearerSecurity,
  request: {
    body: jsonBody(updateProfileSchema),
  },
  responses: {
    200: jsonContent(userProfileSchema, 'Updated user profile'),
    ...standardErrors,
  },
});

const changePasswordRoute = createRoute({
  method: 'put',
  path: '/me/password',
  tags: ['Users'],
  summary: 'Change current user password',
  security: bearerSecurity,
  request: {
    body: jsonBody(changePasswordSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Password updated successfully'),
    ...standardErrors,
  },
});

const changeEmailRoute = createRoute({
  method: 'put',
  path: '/me/email',
  tags: ['Users'],
  summary: 'Request email address change (sends verification to new email)',
  security: bearerSecurity,
  request: {
    body: jsonBody(changeEmailSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Verification email sent'),
    ...standardErrors,
  },
  middleware: [emailChangeRateLimit],
});

const verifyEmailChangeRoute = createRoute({
  method: 'post',
  path: '/me/email/verify',
  tags: ['Users'],
  summary: 'Confirm email change with verification token (public — token is proof)',
  security: noSecurity,
  request: {
    body: jsonBody(verifyEmailChangeSchema),
  },
  responses: {
    200: jsonContent(userProfileSchema, 'Email updated'),
    ...standardErrors,
  },
});

const listOAuthRoute = createRoute({
  method: 'get',
  path: '/me/oauth',
  tags: ['Users'],
  summary: 'List connected OAuth providers',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.object({
      provider: z.string(),
      providerUserId: z.string(),
      createdAt: z.any(),
    })), 'Connected providers'),
    ...standardErrors,
  },
});

const disconnectOAuthRoute = createRoute({
  method: 'delete',
  path: '/me/oauth/{provider}',
  tags: ['Users'],
  summary: 'Disconnect an OAuth provider',
  security: bearerSecurity,
  request: {
    params: z.object({ provider: z.enum(['github', 'google']) }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Provider disconnected'),
    ...standardErrors,
  },
});

const deleteCodeRoute = createRoute({
  method: 'post',
  path: '/me/delete-code',
  tags: ['Users'],
  summary: 'Send account deletion verification code to email',
  security: bearerSecurity,
  responses: {
    200: jsonContent(messageResponseSchema, 'Verification code sent'),
    ...standardErrors,
  },
  middleware: [deleteRateLimit],
});

const deleteMeRoute = createRoute({
  method: 'delete',
  path: '/me',
  tags: ['Users'],
  summary: 'Delete user account (requires password or email verification code)',
  security: bearerSecurity,
  request: {
    body: jsonBody(deleteUserSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Account deleted'),
    ...standardErrors,
  },
  middleware: [deleteRateLimit],
});

const exportDataRoute = createRoute({
  method: 'get',
  path: '/me/export',
  tags: ['Users'],
  summary: 'Download all user data (GDPR export)',
  security: bearerSecurity,
  responses: {
    200: { description: 'JSON data export', content: { 'application/json': { schema: z.any() } } },
    ...standardErrors,
  },
});

const listMyAccountsRoute = createRoute({
  method: 'get',
  path: '/me/accounts',
  tags: ['Users'],
  summary: 'List accounts the current user belongs to',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(accountWithRoleSchema), 'List of accounts with roles'),
    ...standardErrors,
  },
});

const uploadAvatarRoute = createRoute({
  method: 'post',
  path: '/me/avatar',
  tags: ['Users'],
  summary: 'Upload avatar image',
  security: bearerSecurity,
  request: {
    body: {
      content: { 'multipart/form-data': { schema: z.object({ file: z.any() }) } },
    },
  },
  responses: {
    200: jsonContent(userProfileSchema, 'Updated user profile with avatar'),
    ...standardErrors,
  },
});

const deleteAvatarRoute = createRoute({
  method: 'delete',
  path: '/me/avatar',
  tags: ['Users'],
  summary: 'Remove avatar image',
  security: bearerSecurity,
  responses: {
    200: jsonContent(userProfileSchema, 'Updated user profile without avatar'),
    ...standardErrors,
  },
});

const getAvatarRoute = createRoute({
  method: 'get',
  path: '/avatar/{userId}',
  tags: ['Users'],
  summary: 'Get user avatar image',
  security: noSecurity,
  request: {
    params: z.object({ userId: z.string() }),
  },
  responses: {
    200: { description: 'Avatar image' },
    404: { description: 'Avatar not found' },
  },
});

// ── Route handlers ──

// GET /me — get current user profile
userRoutes.openapi(getMeRoute, (async (c: any) => {
  const authUser = c.get('user');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(userProfileResponse(user));
}) as any);

// PATCH /me — update profile
userRoutes.openapi(updateMeRoute, (async (c: any) => {
  const authUser = c.get('user');
  const data = c.req.valid('json');

  const [updated] = await updateReturning(users, {
    ...data,
    updatedAt: new Date(),
  }, eq(users.id, authUser.userId));

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(userProfileResponse(updated));
}) as any);

// PUT /me/password — change password
userRoutes.openapi(changePasswordRoute, (async (c: any) => {
  const authUser = c.get('user');
  const data = c.req.valid('json');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user || !user.passwordHash) {
    return c.json({ error: 'Password change not available for OAuth-only accounts' }, 400);
  }

  const valid = await verify(user.passwordHash, data.currentPassword);
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const newHash = await hash(data.newPassword);

  await db
    .update(users)
    .set({ passwordHash: newHash, securityChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, authUser.userId));

  return c.json({ message: 'Password updated successfully' });
}) as any);

// PUT /me/email — request email change
userRoutes.openapi(changeEmailRoute, (async (c: any) => {
  const authUser = c.get('user');
  const { newEmail, password } = c.req.valid('json');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user || !user.passwordHash) {
    return c.json({ error: 'Password verification required. OAuth-only users must set a password first.' }, 400);
  }

  const valid = await verify(user.passwordHash, password);
  if (!valid) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  if (newEmail === user.email) {
    return c.json({ error: 'New email is the same as current email' }, 400);
  }

  // Check if new email is already taken
  const existing = await db.query.users.findFirst({
    where: and(eq(users.email, newEmail), isNull(users.deletedAt)),
  });
  if (existing) {
    return c.json({ error: 'Email address is already in use' }, 409);
  }

  const token = generateSecureToken();

  const valkey = await getValkey();
  if (!valkey) {
    return c.json({ error: 'Service temporarily unavailable' }, 503);
  }

  await valkey.setex(
    `email-change:${token.hashed}`,
    4 * 60 * 60, // 4 hours
    JSON.stringify({ userId: authUser.userId, newEmail }),
  );

  const appUrl = process.env['APP_URL'] ?? 'http://localhost:5173';
  await queueEmail({
    templateSlug: 'email-change',
    to: newEmail,
    variables: {
      userName: user.name ?? 'User',
      newEmail,
      verifyUrl: `${appUrl}/verify-email-change?token=${token.raw}`,
    },
  });

  return c.json({ message: 'Verification email sent to new address' });
}) as any);

// POST /me/email/verify — confirm email change (public — token is the proof)
userPublicRoutes.openapi(verifyEmailChangeRoute, (async (c: any) => {
  const { token } = c.req.valid('json');
  const hashed = hashToken(token);

  const valkey = await getValkey();
  if (!valkey) {
    return c.json({ error: 'Service temporarily unavailable' }, 503);
  }

  const stored = await valkey.get(`email-change:${hashed}`);
  if (!stored) {
    return c.json({ error: 'Invalid or expired verification token' }, 400);
  }

  const { userId, newEmail } = JSON.parse(stored);

  // Double-check email not taken (race condition guard)
  const existing = await db.query.users.findFirst({
    where: and(eq(users.email, newEmail), isNull(users.deletedAt)),
  });
  if (existing) {
    await valkey.del(`email-change:${hashed}`);
    return c.json({ error: 'Email address is already in use' }, 409);
  }

  const [updated] = await updateReturning(users, {
    email: newEmail,
    emailVerified: true,
    securityChangedAt: new Date(),
    updatedAt: new Date(),
  }, eq(users.id, userId));

  await valkey.del(`email-change:${hashed}`);

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(userProfileResponse(updated));
}) as any);

// GET /me/oauth — list connected OAuth providers
userRoutes.openapi(listOAuthRoute, (async (c: any) => {
  const authUser = c.get('user');

  const providers = await db.query.oauthProviders.findMany({
    where: eq(oauthProviders.userId, authUser.userId),
  });

  return c.json(providers.map((p: any) => ({
    provider: p.provider,
    providerUserId: p.providerUserId,
    createdAt: p.createdAt,
  })));
}) as any);

// DELETE /me/oauth/:provider — disconnect an OAuth provider
userRoutes.openapi(disconnectOAuthRoute, (async (c: any) => {
  const authUser = c.get('user');
  const { provider } = c.req.valid('param');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Check that user has another auth method to prevent lockout
  const allProviders = await db.query.oauthProviders.findMany({
    where: eq(oauthProviders.userId, authUser.userId),
  });

  const hasPassword = !!user.passwordHash;
  const otherProviders = allProviders.filter((p: any) => p.provider !== provider);

  if (!hasPassword && otherProviders.length === 0) {
    return c.json({ error: 'Cannot disconnect — this is your only login method. Set a password first.' }, 400);
  }

  const target = allProviders.find((p: any) => p.provider === provider);
  if (!target) {
    return c.json({ error: 'Provider not connected' }, 404);
  }

  await db.delete(oauthProviders).where(eq(oauthProviders.id, target.id));

  return c.json({ message: `${provider} disconnected` });
}) as any);

// POST /me/delete-code — send deletion verification code
userRoutes.openapi(deleteCodeRoute, (async (c: any) => {
  const authUser = c.get('user');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user || !user.email) {
    return c.json({ error: 'User not found' }, 404);
  }

  const valkey = await getValkey();
  if (!valkey) {
    return c.json({ error: 'Service temporarily unavailable' }, 503);
  }

  // Generate 6-digit code
  const code = String(crypto.randomInt(100000, 999999));
  await valkey.setex(`delete-code:${authUser.userId}`, 600, code); // 10 min TTL

  await queueEmail({
    templateSlug: 'account-deletion-code',
    to: user.email,
    variables: {
      userName: user.name ?? 'User',
      code,
    },
  });

  return c.json({ message: 'Verification code sent to your email' });
}) as any);

// DELETE /me — delete user account
userRoutes.openapi(deleteMeRoute, (async (c: any) => {
  const authUser = c.get('user');
  const data = c.req.valid('json');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Super admins cannot delete themselves — must be demoted first
  if (user.isSuper) {
    return c.json({ error: 'Super admin accounts cannot be self-deleted. Remove super admin privileges first.' }, 403);
  }

  // Verify identity
  let verified = false;

  if (data.password && user.passwordHash) {
    verified = await verify(user.passwordHash, data.password);
    if (!verified) {
      return c.json({ error: 'Invalid password' }, 401);
    }
  }

  if (!verified && data.emailCode) {
    const valkey = await getValkey();
    if (valkey) {
      const storedCode = await valkey.get(`delete-code:${authUser.userId}`);
      if (storedCode && storedCode === data.emailCode) {
        verified = true;
        await valkey.del(`delete-code:${authUser.userId}`);
      }
    }
    if (!verified) {
      return c.json({ error: 'Invalid or expired verification code' }, 401);
    }
  }

  if (!verified) {
    return c.json({ error: 'Password or email verification code required' }, 400);
  }

  // Find all accounts where this user is the sole member
  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, authUser.userId),
    with: { account: true },
  });

  const scheduledDate = new Date();
  scheduledDate.setDate(scheduledDate.getDate() + 30);

  // Handle accounts where user is the sole member
  for (const membership of memberships) {
    const accountMembers = await db.query.userAccounts.findMany({
      where: eq(userAccounts.accountId, membership.accountId),
    });

    if (accountMembers.length === 1) {
      // Sole member — suspend account and schedule deletion
      const acct = membership.account as any;
      if (!acct) continue;

      const descendants = await db.query.accounts.findMany({
        where: and(like(accounts.path, `${acct.path}.%`), isNull(accounts.deletedAt)),
        limit: 1000,
      });

      const allAccountIds = [acct.id, ...descendants.map((d: any) => d.id)];

      await safeTransaction(async (tx) => {
        for (const accId of allAccountIds) {
          await tx.update(accounts).set({
            scheduledDeletionAt: scheduledDate,
            status: 'pending_deletion',
            updatedAt: new Date(),
          }).where(eq(accounts.id, accId));

          // Stop all services
          const accountServices = await tx.query.services.findMany({
            where: and(eq(services.accountId, accId), isNull(services.deletedAt)),
          });

          for (const svc of accountServices) {
            await tx.update(services).set({
              status: 'stopped',
              stoppedAt: new Date(),
              updatedAt: new Date(),
            }).where(eq(services.id, svc.id));
          }
        }
      });

      // Scale down Docker services outside transaction
      for (const accId of allAccountIds) {
        const accountServices = await db.query.services.findMany({
          where: and(eq(services.accountId, accId), isNull(services.deletedAt)),
        });

        for (const svc of accountServices) {
          if (svc.dockerServiceId && svc.status !== 'stopped') {
            try {
              await dockerService.scaleService(svc.dockerServiceId, 0);
            } catch (err) {
              logger.error({ err, serviceId: svc.id }, 'Failed to stop service during user deletion');
            }
          }
        }
      }
    }
  }

  // Remove all account memberships
  await db.delete(userAccounts).where(eq(userAccounts.userId, authUser.userId));

  // Remove OAuth links
  await db.delete(oauthProviders).where(eq(oauthProviders.userId, authUser.userId));

  // Soft-delete the user
  await db.update(users).set({
    deletedAt: new Date(),
    securityChangedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(users.id, authUser.userId));

  // Clear refresh cookie
  deleteCookie(c, 'fleet_refresh', { path: '/' });

  logger.info({ userId: authUser.userId }, 'User self-deleted');

  return c.json({ message: 'Your account has been deleted' });
}) as any);

// GET /me/export — GDPR data export
userRoutes.openapi(exportDataRoute, (async (c: any) => {
  const authUser = c.get('user');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Gather all user data
  const providers = await db.query.oauthProviders.findMany({
    where: eq(oauthProviders.userId, authUser.userId),
  });

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, authUser.userId),
    with: { account: true },
  });

  const accountIds = memberships.map((m: any) => m.accountId);

  // Services across all user's accounts
  let userServices: any[] = [];
  for (const accId of accountIds) {
    const acctServices = await db.query.services.findMany({
      where: and(eq(services.accountId, accId), isNull(services.deletedAt)),
    });
    userServices.push(...acctServices.map((s: any) => ({
      id: s.id,
      name: s.name,
      image: s.image,
      domain: s.domain,
      status: s.status,
      createdAt: s.createdAt,
    })));
  }

  // Recent deployments across all user's services
  let userDeployments: any[] = [];
  const serviceIds = userServices.map((s: any) => s.id).filter(Boolean);
  for (const svcId of serviceIds) {
    const svcDeployments = await db.query.deployments.findMany({
      where: eq(deployments.serviceId, svcId),
      limit: 20,
      orderBy: (d: any, { desc: d2 }: any) => d2(d.createdAt),
    });
    userDeployments.push(...svcDeployments.map((d: any) => ({
      serviceId: d.serviceId,
      status: d.status,
      imageTag: d.imageTag,
      createdAt: d.createdAt,
    })));
  }

  // SSH keys (linked to user, not account)
  const userSshKeys = await db.query.sshKeys.findMany({
    where: eq(sshKeys.userId, authUser.userId),
  });

  // API keys
  let userApiKeys: any[] = [];
  for (const accId of accountIds) {
    const keys = await db.query.apiKeys.findMany({
      where: eq(apiKeys.accountId, accId),
    });
    userApiKeys.push(...keys.map((k: any) => ({
      name: k.name,
      scopes: k.scopes,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
    })));
  }

  // Domains
  let userDomains: any[] = [];
  for (const accId of accountIds) {
    const zones = await db.query.dnsZones.findMany({
      where: eq(dnsZones.accountId, accId),
    });
    userDomains.push(...zones.map((z: any) => ({
      domain: z.domain,
      accountId: z.accountId,
      createdAt: z.createdAt,
    })));
  }

  // Activity log for this user
  const activity = await db.query.auditLog.findMany({
    where: eq(auditLog.userId, authUser.userId),
    limit: 500,
    orderBy: (a: any, { desc: d2 }: any) => d2(a.createdAt),
  });

  const exportData = {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    oauthProviders: providers.map((p: any) => ({
      provider: p.provider,
      providerUserId: p.providerUserId,
      createdAt: p.createdAt,
    })),
    accountMemberships: memberships.map((m: any) => ({
      accountName: m.account?.name,
      accountSlug: m.account?.slug,
      role: m.role,
      createdAt: m.createdAt,
    })),
    services: userServices,
    deployments: userDeployments,
    sshKeys: userSshKeys.map((k: any) => ({
      name: k.name,
      fingerprint: k.fingerprint,
      createdAt: k.createdAt,
    })),
    apiKeys: userApiKeys,
    domains: userDomains,
    activityLog: activity.map((a: any) => ({
      eventType: a.eventType,
      description: a.description,
      ipAddress: a.ipAddress,
      createdAt: a.createdAt,
    })),
  };

  c.header('Content-Disposition', 'attachment; filename="fleet-data-export.json"');
  return c.json(exportData);
}) as any);

// GET /me/accounts — list all accounts user belongs to
userRoutes.openapi(listMyAccountsRoute, (async (c: any) => {
  const authUser = c.get('user');

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, authUser.userId),
    with: { account: true },
  });

  return c.json(
    memberships.map((m: any) => ({
      ...m.account,
      role: m.role,
    })),
  );
}) as any);

// POST /me/avatar — upload avatar image
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const AVATAR_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

userRoutes.openapi(uploadAvatarRoute, (async (c: any) => {
  const authUser = c.get('user');
  const body = await c.req.parseBody({ all: true });
  const file = body['file'] as File | undefined;

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file provided' }, 400);
  }

  if (!AVATAR_ALLOWED_TYPES.has(file.type)) {
    return c.json({ error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' }, 400);
  }

  if (file.size > AVATAR_MAX_BYTES) {
    return c.json({ error: 'File too large. Maximum size is 2 MB' }, 400);
  }

  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  const key = `avatars/${authUser.userId}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Delete any previous avatar with a different extension
  for (const prevExt of ['jpg', 'png', 'gif', 'webp']) {
    if (prevExt !== ext) {
      try {
        await storageManager.objects.deleteObject(STORAGE_BUCKETS.UPLOADS, `avatars/${authUser.userId}.${prevExt}`);
      } catch { /* ignore */ }
    }
  }

  await storageManager.objects.putObject(STORAGE_BUCKETS.UPLOADS, key, buffer, buffer.length);

  const avatarUrl = `/api/v1/users/avatar/${authUser.userId}`;
  const [updated] = await updateReturning(users, {
    avatarUrl,
    updatedAt: new Date(),
  }, eq(users.id, authUser.userId));

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(userProfileResponse(updated));
}) as any);

// DELETE /me/avatar — remove avatar
userRoutes.openapi(deleteAvatarRoute, (async (c: any) => {
  const authUser = c.get('user');

  // Delete all possible avatar files
  for (const ext of ['jpg', 'png', 'gif', 'webp']) {
    try {
      await storageManager.objects.deleteObject(STORAGE_BUCKETS.UPLOADS, `avatars/${authUser.userId}.${ext}`);
    } catch { /* ignore */ }
  }

  const [updated] = await updateReturning(users, {
    avatarUrl: null,
    updatedAt: new Date(),
  }, eq(users.id, authUser.userId));

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(userProfileResponse(updated));
}) as any);

// GET /avatar/:userId — serve avatar image (public)
userPublicRoutes.openapi(getAvatarRoute, (async (c: any) => {
  const { userId } = c.req.valid('param');

  for (const ext of ['jpg', 'png', 'gif', 'webp']) {
    const key = `avatars/${userId}.${ext}`;
    const exists = await storageManager.objects.objectExists(STORAGE_BUCKETS.UPLOADS, key);
    if (exists) {
      const buffer = await storageManager.objects.getObjectBuffer(STORAGE_BUCKETS.UPLOADS, key);
      const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      c.header('Content-Type', mimeType);
      c.header('Cache-Control', 'public, max-age=3600');
      return c.body(buffer);
    }
  }

  return c.json({ error: 'Avatar not found' }, 404);
}) as any);

export default userRoutes;
