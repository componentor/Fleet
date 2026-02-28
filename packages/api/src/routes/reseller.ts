import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity, noSecurity } from './_schemas.js';
import {
  db,
  accounts,
  resellerConfig,
  resellerAccounts,
  resellerApplications,
  billingPlans,
  billingConfig,
  users,
  userAccounts,
  insertReturning,
  updateReturning,
  eq,
  and,
  isNull,
} from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { getAppUrl } from '../services/platform.service.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireAdmin, requireOwner } from '../middleware/rbac.js';
import { stripeService } from '../services/stripe.service.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { hash } from 'argon2';
import { logger } from '../services/logger.js';
import { getEmailQueue, isQueueAvailable } from '../services/queue.service.js';
import type { EmailJobData } from '../workers/email.worker.js';
import { generateTokens } from './auth.js';

async function queueEmail(data: EmailJobData): Promise<void> {
  if (isQueueAvailable()) {
    await getEmailQueue().add('send-email', data);
  }
}

type ResellerEnv = {
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
};

const reseller = new OpenAPIHono<ResellerEnv>();

// ── Helper: calculate discount amount ─────────────────────────────────────────

export function calculateDiscount(
  baseCents: number,
  discountType: string | null,
  discountPercent: number | null,
  discountFixed: number | null,
): number {
  if (!discountType) return 0;
  let amount = 0;
  if (discountType === 'percentage' || discountType === 'hybrid') {
    amount += Math.round(baseCents * ((discountPercent ?? 0) / 100));
  }
  if (discountType === 'fixed' || discountType === 'hybrid') {
    amount += discountFixed ?? 0;
  }
  return Math.min(amount, baseCents);
}

export function calculateMarkup(
  baseCents: number,
  markupType: string | null,
  markupPercent: number | null,
  markupFixed: number | null,
): number {
  if (!markupType) return 0;
  let amount = 0;
  if (markupType === 'percentage' || markupType === 'hybrid') {
    amount += Math.round(baseCents * ((markupPercent ?? 0) / 100));
  }
  if (markupType === 'fixed' || markupType === 'hybrid') {
    amount += markupFixed ?? 0;
  }
  return amount;
}

/** Get effective discount for a reseller (per-account override → global default) */
async function getEffectiveDiscount(resellerAccount: typeof resellerAccounts.$inferSelect) {
  if (resellerAccount.discountType) {
    return {
      type: resellerAccount.discountType,
      percent: resellerAccount.discountPercent ?? 0,
      fixed: resellerAccount.discountFixed ?? 0,
    };
  }
  const config = await db.query.resellerConfig.findFirst();
  return {
    type: config?.defaultDiscountType ?? 'percentage',
    percent: config?.defaultDiscountPercent ?? 0,
    fixed: config?.defaultDiscountFixed ?? 0,
  };
}

/** Look up the reseller for an account (checks if account or parent is a reseller) */
export async function findResellerForAccount(accountId: string) {
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!account) return null;

  // Check if account itself is a reseller
  const selfReseller = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (selfReseller) {
    return { reseller: selfReseller, isSubAccount: false };
  }

  // Check if parent is a reseller
  if (account.parentId) {
    const parentReseller = await db.query.resellerAccounts.findFirst({
      where: and(eq(resellerAccounts.accountId, account.parentId), eq(resellerAccounts.status, 'active')),
    });
    if (parentReseller) {
      return { reseller: parentReseller, isSubAccount: true };
    }
  }

  return null;
}

/** Calculate reseller pricing for a given base price */
export async function calculateResellerPricing(accountId: string, basePriceCents: number) {
  const resellerInfo = await findResellerForAccount(accountId);
  if (!resellerInfo) {
    return { finalPrice: basePriceCents, discountAmount: 0, markupAmount: 0, resellerConnectId: null };
  }

  const discount = await getEffectiveDiscount(resellerInfo.reseller);
  const discountAmount = calculateDiscount(basePriceCents, discount.type, discount.percent, discount.fixed);
  const discountedPrice = basePriceCents - discountAmount;

  let markupAmount = 0;
  let resellerConnectId: string | null = null;

  // Sub-accounts pay the reseller's markup; resellers themselves do not
  if (resellerInfo.isSubAccount && resellerInfo.reseller.connectOnboarded && resellerInfo.reseller.stripeConnectId) {
    markupAmount = calculateMarkup(
      discountedPrice,
      resellerInfo.reseller.markupType,
      resellerInfo.reseller.markupPercent,
      resellerInfo.reseller.markupFixed,
    );
    resellerConnectId = resellerInfo.reseller.stripeConnectId;
  }

  return {
    finalPrice: discountedPrice + markupAmount,
    discountAmount,
    markupAmount,
    resellerConnectId,
  };
}

// ── Authenticated + tenant-scoped routes ────────────────────────────────────

const authed = new OpenAPIHono<ResellerEnv>();
authed.use('*', authMiddleware);
authed.use('*', tenantMiddleware);

// GET /status — check if current account is a reseller
const getStatusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Reseller'],
  summary: 'Check reseller status for current account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Reseller status'),
    ...standardErrors,
  },
});

authed.openapi(getStatusRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const config = await db.query.resellerConfig.findFirst();
  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: eq(resellerAccounts.accountId, accountId),
  });

  const pendingApp = await db.query.resellerApplications.findFirst({
    where: and(eq(resellerApplications.accountId, accountId), eq(resellerApplications.status, 'pending')),
  });

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  // Determine if this account can apply
  const isEnabled = config?.enabled ?? false;
  const isAutoApprove = config?.approvalMode === 'auto';
  const hasApplied = !!pendingApp || !!resellerAccount;
  const isSubAccount = !!account?.parentId;

  // Sub-accounts can only become resellers if explicitly enabled by parent reseller
  let canApply = isEnabled && !hasApplied;
  if (isSubAccount) {
    const parentReseller = account?.parentId
      ? await db.query.resellerAccounts.findFirst({
          where: and(eq(resellerAccounts.accountId, account.parentId), eq(resellerAccounts.status, 'active')),
        })
      : null;
    canApply = canApply && !!parentReseller?.canSubAccountResell && (config?.allowSubAccountReselling ?? false);
  }

  return c.json({
    isReseller: resellerAccount?.status === 'active',
    resellerAccount: resellerAccount ?? null,
    config: config ? {
      enabled: config.enabled,
      approvalMode: config.approvalMode,
      allowSubAccountReselling: config.allowSubAccountReselling,
    } : { enabled: false, approvalMode: 'manual', allowSubAccountReselling: false },
    canApply,
    pendingApplication: pendingApp ?? null,
  });
}) as any);

// POST /apply — apply to become a reseller
const applySchema = z.object({
  message: z.string().max(1000).optional(),
});

const applyRoute = createRoute({
  method: 'post',
  path: '/apply',
  tags: ['Reseller'],
  summary: 'Apply to become a reseller',
  security: bearerSecurity,
  request: {
    body: jsonBody(applySchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Application submitted or auto-approved'),
  },
  middleware: [requireOwner, rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'reseller-apply' })],
});

authed.openapi(applyRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const config = await db.query.resellerConfig.findFirst();
  if (!config?.enabled) {
    return c.json({ error: 'Reseller program is not enabled' }, 400);
  }

  // Check not already a reseller or pending
  const existing = await db.query.resellerAccounts.findFirst({
    where: eq(resellerAccounts.accountId, accountId),
  });
  if (existing) {
    return c.json({ error: 'Account is already a reseller' }, 400);
  }

  const pendingApp = await db.query.resellerApplications.findFirst({
    where: and(eq(resellerApplications.accountId, accountId), eq(resellerApplications.status, 'pending')),
  });
  if (pendingApp) {
    return c.json({ error: 'Application already pending' }, 400);
  }

  const data = c.req.valid('json');

  if (config.approvalMode === 'auto') {
    // Auto-approve: create reseller account directly
    const [created] = await insertReturning(resellerAccounts, {
      accountId,
      status: 'active',
      approvedAt: new Date(),
    });

    // Also create application record for audit trail
    await db.insert(resellerApplications).values({
      accountId,
      message: data.message ?? null,
      status: 'approved',
      reviewedAt: new Date(),
      reviewNote: 'Auto-approved',
    });

    logger.info({ accountId, userId: user.userId }, 'Reseller auto-approved');
    return c.json({ message: 'Approved as reseller', resellerAccount: created }, 201);
  }

  // Manual approval: create application
  const [app] = await insertReturning(resellerApplications, {
    accountId,
    message: data.message ?? null,
    status: 'pending',
  });

  // Notify super admins
  try {
    const superUsers = await db.query.users.findMany({
      where: eq(users.isSuper, true),
    });
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
    });

    for (const su of superUsers) {
      queueEmail({
        templateSlug: 'reseller-application',
        to: su.email!,
        variables: {
          accountName: account?.name ?? 'Unknown',
          message: data.message ?? '',
          adminUrl: `${await getAppUrl()}/admin/resellers`,
        },
      }).catch(() => {});
    }
  } catch {
    // Non-critical
  }

  logger.info({ accountId, userId: user.userId }, 'Reseller application submitted');
  return c.json({ message: 'Application submitted', application: app }, 201);
}) as any);

// GET /dashboard — reseller dashboard data
const getDashboardRoute = createRoute({
  method: 'get',
  path: '/dashboard',
  tags: ['Reseller'],
  summary: 'Get reseller dashboard data',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Dashboard data'),
    ...standardErrors,
  },
});

authed.openapi(getDashboardRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });

  if (!resellerAccount) {
    return c.json({ error: 'Not a reseller' }, 403);
  }

  const discount = await getEffectiveDiscount(resellerAccount);

  // Count sub-accounts
  const subAccounts = await db.query.accounts.findMany({
    where: and(eq(accounts.parentId, accountId), isNull(accounts.deletedAt)),
    columns: { id: true, name: true, slug: true, status: true },
  });

  return c.json({
    resellerAccount,
    effectiveDiscount: discount,
    subAccountCount: subAccounts.length,
    subAccounts,
  });
}) as any);

// PATCH /markup — update reseller's own markup
const markupSchema = z.object({
  markupType: z.enum(['percentage', 'fixed', 'hybrid']),
  markupPercent: z.number().int().min(0).max(100).optional(),
  markupFixed: z.number().int().min(0).optional(),
});

const patchMarkupRoute = createRoute({
  method: 'patch',
  path: '/markup',
  tags: ['Reseller'],
  summary: 'Update reseller markup settings',
  security: bearerSecurity,
  request: {
    body: jsonBody(markupSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Markup updated'),
    ...standardErrors,
  },
  middleware: [requireOwner],
});

authed.openapi(patchMarkupRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Not a reseller' }, 403);
  }

  const data = c.req.valid('json');

  const [updated] = await updateReturning(resellerAccounts, {
    markupType: data.markupType,
    markupPercent: data.markupPercent ?? 0,
    markupFixed: data.markupFixed ?? 0,
    updatedAt: new Date(),
  }, eq(resellerAccounts.id, resellerAccount.id));

  return c.json({ message: 'Markup updated', resellerAccount: updated });
}) as any);

// PATCH /branding — update reseller branding
const brandingSchema = z.object({
  signupSlug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
  customDomain: z.string().max(255).optional(),
  brandName: z.string().max(255).optional(),
  brandLogoUrl: z.string().url().max(1024).optional(),
  brandPrimaryColor: z.string().max(20).regex(/^#[0-9a-fA-F]{6}$/).optional(),
  brandDescription: z.string().max(500).optional(),
});

const patchBrandingRoute = createRoute({
  method: 'patch',
  path: '/branding',
  tags: ['Reseller'],
  summary: 'Update reseller branding',
  security: bearerSecurity,
  request: {
    body: jsonBody(brandingSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Branding updated'),
    ...standardErrors,
  },
  middleware: [requireOwner],
});

authed.openapi(patchBrandingRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Not a reseller' }, 403);
  }

  const data = c.req.valid('json');

  // Check slug uniqueness if changing
  if (data.signupSlug && data.signupSlug !== resellerAccount.signupSlug) {
    const existingSlug = await db.query.resellerAccounts.findFirst({
      where: eq(resellerAccounts.signupSlug, data.signupSlug),
    });
    if (existingSlug) {
      return c.json({ error: 'This signup slug is already taken' }, 400);
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.signupSlug !== undefined) updateData['signupSlug'] = data.signupSlug;
  if (data.customDomain !== undefined) updateData['customDomain'] = data.customDomain || null;
  if (data.brandName !== undefined) updateData['brandName'] = data.brandName || null;
  if (data.brandLogoUrl !== undefined) updateData['brandLogoUrl'] = data.brandLogoUrl || null;
  if (data.brandPrimaryColor !== undefined) updateData['brandPrimaryColor'] = data.brandPrimaryColor || null;
  if (data.brandDescription !== undefined) updateData['brandDescription'] = data.brandDescription || null;

  const [updated] = await updateReturning(resellerAccounts, updateData, eq(resellerAccounts.id, resellerAccount.id));

  return c.json({ message: 'Branding updated', resellerAccount: updated });
}) as any);

// POST /connect — start Stripe Connect onboarding
const postConnectRoute = createRoute({
  method: 'post',
  path: '/connect',
  tags: ['Reseller'],
  summary: 'Start Stripe Connect onboarding',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({ url: z.string() }), 'Connect onboarding URL'),
    ...standardErrors,
  },
  middleware: [requireOwner],
});

authed.openapi(postConnectRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Not a reseller' }, 403);
  }

  const appUrl = await getAppUrl();

  let connectId = resellerAccount.stripeConnectId;
  if (!connectId) {
    const connectAccount = await stripeService.createConnectAccount(user.email, {
      accountId,
      platform: 'fleet',
    });
    connectId = connectAccount.id;
    await db.update(resellerAccounts)
      .set({ stripeConnectId: connectId, updatedAt: new Date() })
      .where(eq(resellerAccounts.id, resellerAccount.id));
  }

  const accountLink = await stripeService.createAccountLink(
    connectId,
    `${appUrl}/panel/reseller?refresh=1`,
    `${appUrl}/panel/reseller?connected=1`,
  );

  return c.json({ url: accountLink.url });
}) as any);

// GET /connect/status — check Stripe Connect onboarding status
const getConnectStatusRoute = createRoute({
  method: 'get',
  path: '/connect/status',
  tags: ['Reseller'],
  summary: 'Check Stripe Connect onboarding status',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Connect status'),
    ...standardErrors,
  },
});

authed.openapi(getConnectStatusRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount?.stripeConnectId) {
    return c.json({ connected: false, onboarded: false });
  }

  try {
    const account = await stripeService.getConnectAccount(resellerAccount.stripeConnectId);
    const onboarded = account.charges_enabled && account.payouts_enabled;

    if (onboarded && !resellerAccount.connectOnboarded) {
      await db.update(resellerAccounts)
        .set({ connectOnboarded: true, updatedAt: new Date() })
        .where(eq(resellerAccounts.id, resellerAccount.id));
    }

    return c.json({
      connected: true,
      onboarded,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    });
  } catch {
    return c.json({ connected: false, onboarded: false });
  }
}) as any);

// GET /connect/dashboard — get a Stripe Express dashboard login link
const getConnectDashboardRoute = createRoute({
  method: 'get',
  path: '/connect/dashboard',
  tags: ['Reseller'],
  summary: 'Get Stripe Express dashboard login link',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({ url: z.string() }), 'Dashboard login link'),
    ...standardErrors,
  },
});

authed.openapi(getConnectDashboardRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount?.stripeConnectId || !resellerAccount.connectOnboarded) {
    return c.json({ error: 'Stripe Connect not set up' }, 400);
  }

  try {
    const loginLink = await stripeService.createConnectLoginLink(resellerAccount.stripeConnectId);
    return c.json({ url: loginLink.url });
  } catch (err: any) {
    logger.error({ err, accountId }, 'Failed to create Connect dashboard link');
    return c.json({ error: 'Failed to create dashboard link' }, 500);
  }
}) as any);

// GET /earnings — reseller earnings overview from sub-account subscriptions
const getEarningsRoute = createRoute({
  method: 'get',
  path: '/earnings',
  tags: ['Reseller'],
  summary: 'Get reseller earnings overview',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Earnings data'),
    ...standardErrors,
  },
});

authed.openapi(getEarningsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Not a reseller' }, 403);
  }

  // Get all sub-accounts with their subscriptions
  const subAccountsList = await db.query.accounts.findMany({
    where: and(eq(accounts.parentId, accountId), isNull(accounts.deletedAt)),
    columns: { id: true, name: true, slug: true, status: true },
  });

  const { subscriptions: subscriptionsTable } = await import('@fleet/db');
  const { eq: eq2 } = await import('@fleet/db');

  let activeSubscriptions = 0;
  let estimatedMonthlyRevenueCents = 0;
  const subAccountEarnings: { id: string; name: string; status: string; hasSubscription: boolean; monthlyRevenueCents: number }[] = [];

  const discount = await getEffectiveDiscount(resellerAccount);

  for (const sub of subAccountsList) {
    const subscription = await db.query.subscriptions.findFirst({
      where: and(eq2(subscriptionsTable.accountId, sub.id), eq2(subscriptionsTable.status, 'active')),
      with: { plan: true },
    });

    if (subscription?.plan) {
      activeSubscriptions++;
      const planPrice = (subscription.plan as any).priceCents ?? 0;
      const discountAmount = calculateDiscount(planPrice, discount.type, discount.percent, discount.fixed);
      const discountedPrice = planPrice - discountAmount;
      const markupAmount = calculateMarkup(
        discountedPrice,
        resellerAccount.markupType,
        resellerAccount.markupPercent,
        resellerAccount.markupFixed,
      );
      estimatedMonthlyRevenueCents += markupAmount;
      subAccountEarnings.push({
        id: sub.id,
        name: sub.name ?? sub.slug ?? sub.id,
        status: sub.status ?? 'active',
        hasSubscription: true,
        monthlyRevenueCents: markupAmount,
      });
    } else {
      subAccountEarnings.push({
        id: sub.id,
        name: sub.name ?? sub.slug ?? sub.id,
        status: sub.status ?? 'active',
        hasSubscription: false,
        monthlyRevenueCents: 0,
      });
    }
  }

  return c.json({
    totalSubAccounts: subAccountsList.length,
    activeSubscriptions,
    estimatedMonthlyRevenueCents,
    subAccountEarnings,
    stripeConnected: !!resellerAccount.stripeConnectId && !!resellerAccount.connectOnboarded,
  });
}) as any);

// POST /sub-accounts/:subAccountId/enable-reselling
const enableResellingRoute = createRoute({
  method: 'post',
  path: '/sub-accounts/{subAccountId}/enable-reselling',
  tags: ['Reseller'],
  summary: 'Enable reselling for a sub-account',
  security: bearerSecurity,
  request: {
    params: z.object({ subAccountId: z.string() }),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Reselling enabled'),
  },
  middleware: [requireOwner],
});

authed.openapi(enableResellingRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { subAccountId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const config = await db.query.resellerConfig.findFirst();
  if (!config?.allowSubAccountReselling) {
    return c.json({ error: 'Sub-account reselling is not enabled' }, 400);
  }

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount?.canSubAccountResell) {
    return c.json({ error: 'You do not have permission to enable sub-account reselling' }, 403);
  }

  // Verify sub-account is a child of this account
  const subAccount = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, subAccountId), eq(accounts.parentId, accountId), isNull(accounts.deletedAt)),
  });
  if (!subAccount) {
    return c.json({ error: 'Sub-account not found' }, 404);
  }

  // Create reseller account for sub-account
  const existing = await db.query.resellerAccounts.findFirst({
    where: eq(resellerAccounts.accountId, subAccountId),
  });
  if (existing) {
    return c.json({ error: 'Sub-account is already a reseller' }, 400);
  }

  const [created] = await insertReturning(resellerAccounts, {
    accountId: subAccountId,
    status: 'active',
    approvedAt: new Date(),
    approvedBy: c.get('user').userId,
  });

  return c.json({ message: 'Reselling enabled for sub-account', resellerAccount: created }, 201);
}) as any);

// POST /sub-accounts/:subAccountId/disable-reselling
const disableResellingRoute = createRoute({
  method: 'post',
  path: '/sub-accounts/{subAccountId}/disable-reselling',
  tags: ['Reseller'],
  summary: 'Disable reselling for a sub-account',
  security: bearerSecurity,
  request: {
    params: z.object({ subAccountId: z.string() }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Reselling disabled'),
    ...standardErrors,
  },
  middleware: [requireOwner],
});

authed.openapi(disableResellingRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { subAccountId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const subAccount = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, subAccountId), eq(accounts.parentId, accountId), isNull(accounts.deletedAt)),
  });
  if (!subAccount) {
    return c.json({ error: 'Sub-account not found' }, 404);
  }

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: eq(resellerAccounts.accountId, subAccountId),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Sub-account is not a reseller' }, 400);
  }

  await db.update(resellerAccounts)
    .set({ status: 'suspended', updatedAt: new Date() })
    .where(eq(resellerAccounts.id, resellerAccount.id));

  return c.json({ message: 'Reselling disabled for sub-account' });
}) as any);

// GET /parent-branding — get parent reseller's branding for sub-account dashboard
const getParentBrandingRoute = createRoute({
  method: 'get',
  path: '/parent-branding',
  tags: ['Reseller'],
  summary: 'Get parent reseller branding for sub-account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Parent branding data'),
    ...standardErrors,
  },
});

authed.openapi(getParentBrandingRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ found: false });

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  if (!account?.parentId) {
    return c.json({ found: false });
  }

  const parentReseller = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, account.parentId), eq(resellerAccounts.status, 'active')),
    with: { account: { columns: { id: true, name: true } } },
  });

  if (!parentReseller) {
    return c.json({ found: false });
  }

  return c.json({
    found: true,
    brandName: parentReseller.brandName ?? parentReseller.account?.name,
    brandLogoUrl: parentReseller.brandLogoUrl,
    brandPrimaryColor: parentReseller.brandPrimaryColor,
  });
}) as any);

reseller.route('/', authed);

// ── Super admin routes ─────────────────────────────────────────────────────

const admin = new OpenAPIHono<ResellerEnv>();
admin.use('*', authMiddleware);
admin.use('*', tenantMiddleware);

// GET /admin/config
const getConfigRoute = createRoute({
  method: 'get',
  path: '/config',
  tags: ['Reseller'],
  summary: 'Get reseller program configuration',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Reseller config'),
    ...standardErrors,
  },
});

admin.openapi(getConfigRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const config = await db.query.resellerConfig.findFirst();
  return c.json(config ?? {
    enabled: false,
    approvalMode: 'manual',
    allowSubAccountReselling: false,
    defaultDiscountType: 'percentage',
    defaultDiscountPercent: 0,
    defaultDiscountFixed: 0,
  });
}) as any);

// PATCH /admin/config
const configSchema = z.object({
  enabled: z.boolean().optional(),
  approvalMode: z.enum(['auto', 'manual']).optional(),
  allowSubAccountReselling: z.boolean().optional(),
  defaultDiscountType: z.enum(['percentage', 'fixed', 'hybrid']).optional(),
  defaultDiscountPercent: z.number().int().min(0).max(100).optional(),
  defaultDiscountFixed: z.number().int().min(0).optional(),
});

const patchConfigRoute = createRoute({
  method: 'patch',
  path: '/config',
  tags: ['Reseller'],
  summary: 'Update reseller program configuration',
  security: bearerSecurity,
  request: {
    body: jsonBody(configSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated config'),
    201: jsonContent(z.any(), 'Created config'),
  },
  middleware: [rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'reseller-admin' })],
});

admin.openapi(patchConfigRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const data = c.req.valid('json');

  const existing = await db.query.resellerConfig.findFirst();

  if (existing) {
    const [updated] = await updateReturning(resellerConfig, {
      ...data,
      updatedAt: new Date(),
    }, eq(resellerConfig.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(resellerConfig, {
    enabled: data.enabled ?? false,
    approvalMode: data.approvalMode ?? 'manual',
    allowSubAccountReselling: data.allowSubAccountReselling ?? false,
    defaultDiscountType: data.defaultDiscountType ?? 'percentage',
    defaultDiscountPercent: data.defaultDiscountPercent ?? 0,
    defaultDiscountFixed: data.defaultDiscountFixed ?? 0,
  });

  return c.json(created, 201);
}) as any);

// GET /admin/accounts — list all reseller accounts
const getAccountsRoute = createRoute({
  method: 'get',
  path: '/accounts',
  tags: ['Reseller'],
  summary: 'List all reseller accounts',
  security: bearerSecurity,
  request: {
    query: z.object({
      status: z.string().optional(),
    }),
  },
  responses: {
    200: jsonContent(z.any(), 'List of reseller accounts'),
    ...standardErrors,
  },
});

admin.openapi(getAccountsRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const { status: statusFilter } = c.req.valid('query');

  const all = await db.query.resellerAccounts.findMany({
    with: { account: { columns: { id: true, name: true, slug: true } } },
    orderBy: (r: any, { desc: d }: any) => d(r.createdAt),
  });

  const filtered = statusFilter ? all.filter((r: any) => r.status === statusFilter) : all;

  return c.json(filtered);
}) as any);

// PATCH /admin/accounts/:accountId — update a reseller's settings
const updateResellerSchema = z.object({
  discountType: z.enum(['percentage', 'fixed', 'hybrid']).nullable().optional(),
  discountPercent: z.number().int().min(0).max(100).nullable().optional(),
  discountFixed: z.number().int().min(0).nullable().optional(),
  canSubAccountResell: z.boolean().optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

const patchAccountRoute = createRoute({
  method: 'patch',
  path: '/accounts/{accountId}',
  tags: ['Reseller'],
  summary: 'Update a reseller account settings',
  security: bearerSecurity,
  request: {
    params: z.object({ accountId: z.string() }),
    body: jsonBody(updateResellerSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated reseller account'),
    ...standardErrors,
  },
});

admin.openapi(patchAccountRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const { accountId: targetAccountId } = c.req.valid('param');
  const data = c.req.valid('json');

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: eq(resellerAccounts.accountId, targetAccountId),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Reseller account not found' }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.discountType !== undefined) updateData['discountType'] = data.discountType;
  if (data.discountPercent !== undefined) updateData['discountPercent'] = data.discountPercent;
  if (data.discountFixed !== undefined) updateData['discountFixed'] = data.discountFixed;
  if (data.canSubAccountResell !== undefined) updateData['canSubAccountResell'] = data.canSubAccountResell;
  if (data.status !== undefined) updateData['status'] = data.status;

  const [updated] = await updateReturning(resellerAccounts, updateData, eq(resellerAccounts.id, resellerAccount.id));

  logger.info({ targetAccountId, changedBy: user.userId, changes: data }, 'Reseller account updated');
  return c.json(updated);
}) as any);

// GET /admin/applications — list reseller applications
const getApplicationsRoute = createRoute({
  method: 'get',
  path: '/applications',
  tags: ['Reseller'],
  summary: 'List reseller applications',
  security: bearerSecurity,
  request: {
    query: z.object({
      status: z.string().optional(),
    }),
  },
  responses: {
    200: jsonContent(z.any(), 'List of applications'),
    ...standardErrors,
  },
});

admin.openapi(getApplicationsRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const { status: statusFilter } = c.req.valid('query');
  const effectiveFilter = statusFilter ?? 'pending';

  const apps = await db.query.resellerApplications.findMany({
    with: { account: { columns: { id: true, name: true, slug: true } } },
    orderBy: (a: any, { desc: d }: any) => d(a.createdAt),
  });

  const filtered = effectiveFilter === 'all' ? apps : apps.filter((a: any) => a.status === effectiveFilter);

  return c.json(filtered);
}) as any);

// POST /admin/applications/:id/approve
const approveApplicationRoute = createRoute({
  method: 'post',
  path: '/applications/{id}/approve',
  tags: ['Reseller'],
  summary: 'Approve a reseller application',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Application approved'),
    ...standardErrors,
  },
});

admin.openapi(approveApplicationRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const { id: appId } = c.req.valid('param');
  const app = await db.query.resellerApplications.findFirst({
    where: eq(resellerApplications.id, appId),
  });
  if (!app || app.status !== 'pending') {
    return c.json({ error: 'Application not found or already processed' }, 404);
  }

  // Create reseller account
  const [resellerAccount] = await insertReturning(resellerAccounts, {
    accountId: app.accountId,
    status: 'active',
    approvedAt: new Date(),
    approvedBy: user.userId,
  });

  // Update application
  await db.update(resellerApplications)
    .set({ status: 'approved', reviewedBy: user.userId, reviewedAt: new Date() })
    .where(eq(resellerApplications.id, appId));

  logger.info({ appId, accountId: app.accountId, approvedBy: user.userId }, 'Reseller application approved');
  return c.json({ message: 'Application approved', resellerAccount });
}) as any);

// POST /admin/applications/:id/reject
const rejectSchema = z.object({
  note: z.string().max(500).optional(),
});

const rejectApplicationRoute = createRoute({
  method: 'post',
  path: '/applications/{id}/reject',
  tags: ['Reseller'],
  summary: 'Reject a reseller application',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(rejectSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Application rejected'),
    ...standardErrors,
  },
});

admin.openapi(rejectApplicationRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const { id: appId } = c.req.valid('param');
  const app = await db.query.resellerApplications.findFirst({
    where: eq(resellerApplications.id, appId),
  });
  if (!app || app.status !== 'pending') {
    return c.json({ error: 'Application not found or already processed' }, 404);
  }

  const data = c.req.valid('json');

  await db.update(resellerApplications)
    .set({
      status: 'rejected',
      reviewedBy: user.userId,
      reviewedAt: new Date(),
      reviewNote: data.note ?? null,
    })
    .where(eq(resellerApplications.id, appId));

  logger.info({ appId, accountId: app.accountId, rejectedBy: user.userId }, 'Reseller application rejected');
  return c.json({ message: 'Application rejected' });
}) as any);

reseller.route('/admin', admin);

// ── Public routes (no auth) — reseller signup pages ──────────────────────────

const publicRoutes = new OpenAPIHono();

// GET /r/:slug — get reseller signup page data
const getResellerPageRoute = createRoute({
  method: 'get',
  path: '/{slug}',
  tags: ['Reseller'],
  summary: 'Get reseller signup page data',
  security: noSecurity,
  request: {
    params: z.object({ slug: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Reseller page data'),
    ...standardErrors,
  },
  middleware: [rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'reseller-page' })],
});

publicRoutes.openapi(getResellerPageRoute, (async (c: any) => {
  const { slug } = c.req.valid('param');

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.signupSlug, slug), eq(resellerAccounts.status, 'active')),
    with: { account: { columns: { id: true, name: true } } },
  });

  if (!resellerAccount) {
    return c.json({ error: 'Reseller page not found' }, 404);
  }

  const config = await db.query.resellerConfig.findFirst();
  if (!config?.enabled) {
    return c.json({ error: 'Reseller program is not available' }, 404);
  }

  // Get plans with reseller-adjusted pricing
  const plans = await db.query.billingPlans.findMany({
    where: eq(billingPlans.visible, true),
    orderBy: (p: any, { asc }: any) => asc(p.sortOrder),
  });

  const discount = await getEffectiveDiscount(resellerAccount);
  const billingCfg = await db.query.billingConfig.findFirst();

  const adjustedPlans = plans.map((plan: any) => {
    const discountAmount = calculateDiscount(plan.priceCents, discount.type, discount.percent, discount.fixed);
    const discountedPrice = plan.priceCents - discountAmount;
    const markupAmount = calculateMarkup(
      discountedPrice,
      resellerAccount.markupType,
      resellerAccount.markupPercent,
      resellerAccount.markupFixed,
    );
    return {
      ...plan,
      originalPriceCents: plan.priceCents,
      priceCents: discountedPrice + markupAmount,
      discountAmount,
      markupAmount,
    };
  });

  return c.json({
    brandName: resellerAccount.brandName ?? resellerAccount.account?.name ?? 'Reseller',
    brandLogoUrl: resellerAccount.brandLogoUrl,
    brandPrimaryColor: resellerAccount.brandPrimaryColor,
    brandDescription: resellerAccount.brandDescription,
    plans: adjustedPlans,
    billingConfig: billingCfg ? {
      allowedCycles: billingCfg.allowedCycles,
      cycleDiscounts: billingCfg.cycleDiscounts,
    } : null,
  });
}) as any);

// POST /r/:slug/register — register through reseller's page
const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const registerRoute = createRoute({
  method: 'post',
  path: '/{slug}/register',
  tags: ['Reseller'],
  summary: 'Register through reseller signup page',
  security: noSecurity,
  request: {
    params: z.object({ slug: z.string() }),
    body: jsonBody(registerSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'User registered'),
  },
  middleware: [rateLimiter({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'reseller-register' })],
});

publicRoutes.openapi(registerRoute, (async (c: any) => {
  const { slug } = c.req.valid('param');

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.signupSlug, slug), eq(resellerAccounts.status, 'active')),
  });

  if (!resellerAccount) {
    return c.json({ error: 'Reseller page not found' }, 404);
  }

  const config = await db.query.resellerConfig.findFirst();
  if (!config?.enabled) {
    return c.json({ error: 'Reseller program is not available' }, 404);
  }

  const data = c.req.valid('json');
  const { name, email, password } = data;

  // Check if user already exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  if (existingUser) {
    return c.json({ error: 'Email already registered' }, 400);
  }

  const passwordHash = await hash(password);

  // Create user
  const [newUser] = await insertReturning(users, {
    name,
    email: email.toLowerCase(),
    passwordHash,
    isSuper: false,
  });

  if (!newUser) {
    return c.json({ error: 'Registration failed' }, 500);
  }

  // Create account as sub-account of reseller
  const parentAccount = await db.query.accounts.findFirst({
    where: eq(accounts.id, resellerAccount.accountId),
  });

  const accountSlug = email.toLowerCase().split('@')[0] + '-' + Date.now().toString(36);
  const parentPath = parentAccount?.path ?? parentAccount?.slug ?? '';
  const newPath = parentPath ? `${parentPath}/${accountSlug}` : accountSlug;

  const [newAccount] = await insertReturning(accounts, {
    name,
    slug: accountSlug,
    parentId: resellerAccount.accountId,
    path: newPath,
    depth: (parentAccount?.depth ?? 0) + 1,
    status: 'active',
  });

  if (!newAccount) {
    return c.json({ error: 'Account creation failed' }, 500);
  }

  // Link user to account as owner
  await db.insert(userAccounts).values({
    userId: newUser.id,
    accountId: newAccount.id,
    role: 'owner',
  });

  // Generate auth tokens
  const tokens = await generateTokens({ userId: newUser.id, email: newUser.email, isSuper: false });

  logger.info({ userId: newUser.id, accountId: newAccount.id, resellerSlug: slug }, 'User registered via reseller signup');

  return c.json({
    tokens,
    user: { id: newUser.id, name: newUser.name, email: newUser.email },
    account: { id: newAccount.id, name: newAccount.name, slug: newAccount.slug },
  }, 201);
}) as any);

reseller.route('/r', publicRoutes);

// ── Public route: get branding for custom domain ─────────────────────────────

const getBrandingByDomainRoute = createRoute({
  method: 'get',
  path: '/branding/{domain}',
  tags: ['Reseller'],
  summary: 'Get reseller branding by custom domain',
  security: noSecurity,
  request: {
    params: z.object({ domain: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Branding data'),
    ...standardErrors,
  },
  middleware: [rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'reseller-brand' })],
});

reseller.openapi(getBrandingByDomainRoute, (async (c: any) => {
  const { domain } = c.req.valid('param');

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.customDomain, domain), eq(resellerAccounts.status, 'active')),
    with: { account: { columns: { id: true, name: true } } },
  });

  if (!resellerAccount) {
    return c.json({ found: false });
  }

  return c.json({
    found: true,
    slug: resellerAccount.signupSlug,
    brandName: resellerAccount.brandName ?? resellerAccount.account?.name,
    brandLogoUrl: resellerAccount.brandLogoUrl,
    brandPrimaryColor: resellerAccount.brandPrimaryColor,
    brandDescription: resellerAccount.brandDescription,
  });
}) as any);

export default reseller;
