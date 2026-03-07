import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  datetime,
  uniqueIndex,
  json,
} from 'drizzle-orm/mysql-core';
import { sql, relations } from 'drizzle-orm';
import { accounts } from './accounts';
import { adminRoles } from './admin-roles';

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: varchar('email', { length: 255 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  name: varchar('name', { length: 255 }),
  avatarUrl: varchar('avatar_url', { length: 255 }),
  isSuper: boolean('is_super').default(false),
  adminRoleId: varchar('admin_role_id', { length: 36 }).references(() => adminRoles.id, { onDelete: 'set null' }),
  emailVerified: boolean('email_verified').default(false),
  emailVerifyToken: varchar('email_verify_token', { length: 255 }),
  emailVerifyExpires: datetime('email_verify_expires'),
  passwordResetToken: varchar('password_reset_token', { length: 255 }),
  passwordResetExpires: datetime('password_reset_expires'),
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
  twoFactorSecret: varchar('two_factor_secret', { length: 255 }),
  twoFactorBackupCodes: json('two_factor_backup_codes').$type<string[] | null>(),
  disabledLoginMethods: json('disabled_login_methods').$type<string[]>(),
  allowedLoginRegions: json('allowed_login_regions').$type<string[] | null>(),
  securityChangedAt: datetime('security_changed_at'),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
  deletedAt: datetime('deleted_at'),
});

export const userAccounts = mysqlTable(
  'user_accounts',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: varchar('user_id', { length: 36 })
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    accountId: varchar('account_id', { length: 36 })
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    role: varchar('role', { length: 255 }).default('member'),
    createdAt: datetime('created_at').default(sql`(now())`),
  },
  (table) => [
    uniqueIndex('user_accounts_user_account_idx').on(
      table.userId,
      table.accountId,
    ),
  ],
);

export const oauthProviders = mysqlTable(
  'oauth_providers',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: varchar('user_id', { length: 36 })
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    accessToken: varchar('access_token', { length: 255 }),
    createdAt: datetime('created_at').default(sql`(now())`),
  },
  (table) => [
    uniqueIndex('oauth_provider_user_idx').on(
      table.provider,
      table.providerUserId,
    ),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  adminRole: one(adminRoles, {
    fields: [users.adminRoleId],
    references: [adminRoles.id],
  }),
  userAccounts: many(userAccounts),
  oauthProviders: many(oauthProviders),
}));

export const userAccountsRelations = relations(userAccounts, ({ one }) => ({
  user: one(users, {
    fields: [userAccounts.userId],
    references: [users.id],
  }),
  account: one(accounts, {
    fields: [userAccounts.accountId],
    references: [accounts.id],
  }),
}));

export const oauthProvidersRelations = relations(oauthProviders, ({ one }) => ({
  user: one(users, {
    fields: [oauthProviders.userId],
    references: [users.id],
  }),
}));
