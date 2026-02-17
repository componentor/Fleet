// ---------------------------------------------------------------------------
// RBAC — Role-Based Access Control
// ---------------------------------------------------------------------------

export type AccountRole = 'viewer' | 'member' | 'admin' | 'owner';

export const ROLE_HIERARCHY: Record<AccountRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};
