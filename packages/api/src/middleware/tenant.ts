import { createMiddleware } from 'hono/factory';
import { db, accounts, userAccounts, eq } from '@fleet/db';
import type { AuthUser } from './auth.js';

export interface AccountContext {
  id: string;
  name: string;
  slug: string;
  path: string;
  depth: number;
  status: string;
}

export const tenantMiddleware = createMiddleware<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>(async (c, next) => {
  const user = c.get('user');
  const accountIdHeader = c.req.header('X-Account-Id');

  // Super user with no account header operates in admin context
  if (user.isSuper && !accountIdHeader) {
    c.set('account', null);
    c.set('accountId', null);
    await next();
    return;
  }

  if (!accountIdHeader) {
    return c.json({ error: 'X-Account-Id header is required' }, 400);
  }

  // Fetch the target account
  const targetAccount = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountIdHeader),
  });

  if (!targetAccount) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const accountCtx: AccountContext = {
    id: targetAccount.id,
    name: targetAccount.name ?? '',
    slug: targetAccount.slug ?? '',
    path: targetAccount.path ?? '',
    depth: targetAccount.depth ?? 0,
    status: targetAccount.status ?? 'active',
  };

  // Super users can access any account
  if (user.isSuper) {
    c.set('account', accountCtx);
    c.set('accountId', targetAccount.id);
    await next();
    return;
  }

  // Check if user has direct access to this account
  const directAccess = await db.query.userAccounts.findFirst({
    where: (ua, { and, eq: e }) =>
      and(e(ua.userId, user.userId), e(ua.accountId, accountIdHeader)),
  });

  if (directAccess) {
    c.set('account', accountCtx);
    c.set('accountId', targetAccount.id);
    await next();
    return;
  }

  // Check hierarchy access: does the user belong to an ancestor account?
  const userMemberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, user.userId),
    with: { account: true },
  });

  const targetPath = targetAccount.path ?? '';
  const hasHierarchyAccess = userMemberships.some((membership) => {
    const memberPath = membership.account.path ?? '';
    // The user's account path must be a proper prefix of the target path
    // e.g., "acme" is an ancestor of "acme.sub1.sub2"
    return (
      targetPath.startsWith(memberPath) &&
      targetPath.length > memberPath.length &&
      targetPath[memberPath.length] === '.'
    );
  });

  if (!hasHierarchyAccess) {
    return c.json({ error: 'Forbidden: you do not have access to this account' }, 403);
  }

  c.set('account', accountCtx);
  c.set('accountId', targetAccount.id);

  await next();
});
