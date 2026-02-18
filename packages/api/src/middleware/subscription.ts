import { createMiddleware } from 'hono/factory';
import { db, subscriptions, billingPlans, eq, and } from '@fleet/db';
import type { AuthUser } from './auth.js';

/**
 * Middleware that blocks resource-creating operations (POST /services, POST /deployments, POST /backups)
 * unless the account has an active subscription OR is on a free plan.
 * Super users and admin-context (no accountId) bypass this check.
 */
export const requireActiveSubscription = createMiddleware<{
  Variables: {
    user: AuthUser;
    accountId: string | null;
  };
}>(async (c, next) => {
  const user = c.get('user');

  // Super users bypass subscription checks
  if (user.isSuper) {
    await next();
    return;
  }

  const accountId = c.get('accountId');
  if (!accountId) {
    await next();
    return;
  }

  // Check for active subscription
  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.accountId, accountId),
      eq(subscriptions.status, 'active'),
    ),
    with: { plan: true },
  });

  // Allow if they have an active subscription
  if (sub) {
    await next();
    return;
  }

  // Check if any free plan exists and account might be implicitly on it
  // (accounts without a subscription are allowed if billing is not required)
  const freePlan = await db.query.billingPlans.findFirst({
    where: eq(billingPlans.isFree, true),
  });

  if (freePlan) {
    // Free plan exists — allow access without subscription
    await next();
    return;
  }

  // Also check if there are ANY billing plans configured. If billing isn't set up,
  // don't block users (platform may not use billing at all)
  const anyPlan = await db.query.billingPlans.findFirst();
  if (!anyPlan) {
    await next();
    return;
  }

  return c.json({ error: 'Active subscription required. Please subscribe to a plan.' }, 402);
});
