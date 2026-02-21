import { Hono } from 'hono';
import { z } from 'zod';
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

const reseller = new Hono<ResellerEnv>();

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

const authed = new Hono<ResellerEnv>();
authed.use('*', authMiddleware);
authed.use('*', tenantMiddleware);

// GET /status — check if current account is a reseller
authed.get('/status', async (c) => {
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
});

// POST /apply — apply to become a reseller
const applySchema = z.object({
  message: z.string().max(1000).optional(),
});

authed.post('/apply', requireOwner, rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'reseller-apply' }), async (c) => {
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

  const body = await c.req.json();
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

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
      message: parsed.data.message ?? null,
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
    message: parsed.data.message ?? null,
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
          message: parsed.data.message ?? '',
          adminUrl: `${process.env['APP_URL'] ?? ''}/admin/resellers`,
        },
      }).catch(() => {});
    }
  } catch {
    // Non-critical
  }

  logger.info({ accountId, userId: user.userId }, 'Reseller application submitted');
  return c.json({ message: 'Application submitted', application: app }, 201);
});

// GET /dashboard — reseller dashboard data
authed.get('/dashboard', async (c) => {
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
});

// PATCH /markup — update reseller's own markup
const markupSchema = z.object({
  markupType: z.enum(['percentage', 'fixed', 'hybrid']),
  markupPercent: z.number().int().min(0).max(100).optional(),
  markupFixed: z.number().int().min(0).optional(),
});

authed.patch('/markup', requireOwner, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Not a reseller' }, 403);
  }

  const body = await c.req.json();
  const parsed = markupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const [updated] = await updateReturning(resellerAccounts, {
    markupType: parsed.data.markupType,
    markupPercent: parsed.data.markupPercent ?? 0,
    markupFixed: parsed.data.markupFixed ?? 0,
    updatedAt: new Date(),
  }, eq(resellerAccounts.id, resellerAccount.id));

  return c.json({ message: 'Markup updated', resellerAccount: updated });
});

// PATCH /branding — update reseller branding
const brandingSchema = z.object({
  signupSlug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
  customDomain: z.string().max(255).optional(),
  brandName: z.string().max(255).optional(),
  brandLogoUrl: z.string().url().max(1024).optional(),
  brandPrimaryColor: z.string().max(20).regex(/^#[0-9a-fA-F]{6}$/).optional(),
  brandDescription: z.string().max(500).optional(),
});

authed.patch('/branding', requireOwner, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Not a reseller' }, 403);
  }

  const body = await c.req.json();
  const parsed = brandingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  // Check slug uniqueness if changing
  if (parsed.data.signupSlug && parsed.data.signupSlug !== resellerAccount.signupSlug) {
    const existingSlug = await db.query.resellerAccounts.findFirst({
      where: eq(resellerAccounts.signupSlug, parsed.data.signupSlug),
    });
    if (existingSlug) {
      return c.json({ error: 'This signup slug is already taken' }, 400);
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.signupSlug !== undefined) updateData['signupSlug'] = parsed.data.signupSlug;
  if (parsed.data.customDomain !== undefined) updateData['customDomain'] = parsed.data.customDomain || null;
  if (parsed.data.brandName !== undefined) updateData['brandName'] = parsed.data.brandName || null;
  if (parsed.data.brandLogoUrl !== undefined) updateData['brandLogoUrl'] = parsed.data.brandLogoUrl || null;
  if (parsed.data.brandPrimaryColor !== undefined) updateData['brandPrimaryColor'] = parsed.data.brandPrimaryColor || null;
  if (parsed.data.brandDescription !== undefined) updateData['brandDescription'] = parsed.data.brandDescription || null;

  const [updated] = await updateReturning(resellerAccounts, updateData, eq(resellerAccounts.id, resellerAccount.id));

  return c.json({ message: 'Branding updated', resellerAccount: updated });
});

// POST /connect — start Stripe Connect onboarding
authed.post('/connect', requireOwner, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: and(eq(resellerAccounts.accountId, accountId), eq(resellerAccounts.status, 'active')),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Not a reseller' }, 403);
  }

  const appUrl = process.env['APP_URL'] ?? '';

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
});

// GET /connect/status — check Stripe Connect onboarding status
authed.get('/connect/status', async (c) => {
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
});

// POST /sub-accounts/:subAccountId/enable-reselling
authed.post('/sub-accounts/:subAccountId/enable-reselling', requireOwner, async (c) => {
  const accountId = c.get('accountId');
  const subAccountId = c.req.param('subAccountId');
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
});

// POST /sub-accounts/:subAccountId/disable-reselling
authed.post('/sub-accounts/:subAccountId/disable-reselling', requireOwner, async (c) => {
  const accountId = c.get('accountId');
  const subAccountId = c.req.param('subAccountId');
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
});

// GET /parent-branding — get parent reseller's branding for sub-account dashboard
authed.get('/parent-branding', async (c) => {
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
});

reseller.route('/', authed);

// ── Super admin routes ─────────────────────────────────────────────────────

const admin = new Hono<ResellerEnv>();
admin.use('*', authMiddleware);
admin.use('*', tenantMiddleware);

// GET /admin/config
admin.get('/config', async (c) => {
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
});

// PATCH /admin/config
const configSchema = z.object({
  enabled: z.boolean().optional(),
  approvalMode: z.enum(['auto', 'manual']).optional(),
  allowSubAccountReselling: z.boolean().optional(),
  defaultDiscountType: z.enum(['percentage', 'fixed', 'hybrid']).optional(),
  defaultDiscountPercent: z.number().int().min(0).max(100).optional(),
  defaultDiscountFixed: z.number().int().min(0).optional(),
});

admin.patch('/config', rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'reseller-admin' }), async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const body = await c.req.json();
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const existing = await db.query.resellerConfig.findFirst();

  if (existing) {
    const [updated] = await updateReturning(resellerConfig, {
      ...parsed.data,
      updatedAt: new Date(),
    }, eq(resellerConfig.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(resellerConfig, {
    enabled: parsed.data.enabled ?? false,
    approvalMode: parsed.data.approvalMode ?? 'manual',
    allowSubAccountReselling: parsed.data.allowSubAccountReselling ?? false,
    defaultDiscountType: parsed.data.defaultDiscountType ?? 'percentage',
    defaultDiscountPercent: parsed.data.defaultDiscountPercent ?? 0,
    defaultDiscountFixed: parsed.data.defaultDiscountFixed ?? 0,
  });

  return c.json(created, 201);
});

// GET /admin/accounts — list all reseller accounts
admin.get('/accounts', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const statusFilter = c.req.query('status');

  const all = await db.query.resellerAccounts.findMany({
    with: { account: { columns: { id: true, name: true, slug: true } } },
    orderBy: (r, { desc: d }) => d(r.createdAt),
  });

  const filtered = statusFilter ? all.filter((r) => r.status === statusFilter) : all;

  return c.json(filtered);
});

// PATCH /admin/accounts/:accountId — update a reseller's settings
const updateResellerSchema = z.object({
  discountType: z.enum(['percentage', 'fixed', 'hybrid']).nullable().optional(),
  discountPercent: z.number().int().min(0).max(100).nullable().optional(),
  discountFixed: z.number().int().min(0).nullable().optional(),
  canSubAccountResell: z.boolean().optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

admin.patch('/accounts/:accountId', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const targetAccountId = c.req.param('accountId');

  const body = await c.req.json();
  const parsed = updateResellerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const resellerAccount = await db.query.resellerAccounts.findFirst({
    where: eq(resellerAccounts.accountId, targetAccountId),
  });
  if (!resellerAccount) {
    return c.json({ error: 'Reseller account not found' }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.discountType !== undefined) updateData['discountType'] = parsed.data.discountType;
  if (parsed.data.discountPercent !== undefined) updateData['discountPercent'] = parsed.data.discountPercent;
  if (parsed.data.discountFixed !== undefined) updateData['discountFixed'] = parsed.data.discountFixed;
  if (parsed.data.canSubAccountResell !== undefined) updateData['canSubAccountResell'] = parsed.data.canSubAccountResell;
  if (parsed.data.status !== undefined) updateData['status'] = parsed.data.status;

  const [updated] = await updateReturning(resellerAccounts, updateData, eq(resellerAccounts.id, resellerAccount.id));

  logger.info({ targetAccountId, changedBy: user.userId, changes: parsed.data }, 'Reseller account updated');
  return c.json(updated);
});

// GET /admin/applications — list reseller applications
admin.get('/applications', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const statusFilter = c.req.query('status') ?? 'pending';

  const apps = await db.query.resellerApplications.findMany({
    with: { account: { columns: { id: true, name: true, slug: true } } },
    orderBy: (a, { desc: d }) => d(a.createdAt),
  });

  const filtered = statusFilter === 'all' ? apps : apps.filter((a) => a.status === statusFilter);

  return c.json(filtered);
});

// POST /admin/applications/:id/approve
admin.post('/applications/:id/approve', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const appId = c.req.param('id');
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
});

// POST /admin/applications/:id/reject
const rejectSchema = z.object({
  note: z.string().max(500).optional(),
});

admin.post('/applications/:id/reject', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super admin required' }, 403);

  const appId = c.req.param('id');
  const app = await db.query.resellerApplications.findFirst({
    where: eq(resellerApplications.id, appId),
  });
  if (!app || app.status !== 'pending') {
    return c.json({ error: 'Application not found or already processed' }, 404);
  }

  const body = await c.req.json();
  const parsed = rejectSchema.safeParse(body);

  await db.update(resellerApplications)
    .set({
      status: 'rejected',
      reviewedBy: user.userId,
      reviewedAt: new Date(),
      reviewNote: parsed.success ? parsed.data.note ?? null : null,
    })
    .where(eq(resellerApplications.id, appId));

  logger.info({ appId, accountId: app.accountId, rejectedBy: user.userId }, 'Reseller application rejected');
  return c.json({ message: 'Application rejected' });
});

reseller.route('/admin', admin);

// ── Public routes (no auth) — reseller signup pages ──────────────────────────

const publicRoutes = new Hono();

// GET /r/:slug — get reseller signup page data
publicRoutes.get('/:slug', rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'reseller-page' }), async (c) => {
  const slug = c.req.param('slug');

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
    orderBy: (p, { asc }) => asc(p.sortOrder),
  });

  const discount = await getEffectiveDiscount(resellerAccount);
  const billingCfg = await db.query.billingConfig.findFirst();

  const adjustedPlans = plans.map((plan) => {
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
});

// POST /r/:slug/register — register through reseller's page
const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

publicRoutes.post('/:slug/register', rateLimiter({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'reseller-register' }), async (c) => {
  const slug = c.req.param('slug');

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

  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { name, email, password } = parsed.data;

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
});

reseller.route('/r', publicRoutes);

// ── Public route: get branding for custom domain ─────────────────────────────

reseller.get('/branding/:domain', rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'reseller-brand' }), async (c) => {
  const domain = c.req.param('domain');

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
});

export default reseller;
