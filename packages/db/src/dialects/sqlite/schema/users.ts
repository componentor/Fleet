import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { adminRoles } from './admin-roles';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  isSuper: integer('is_super', { mode: 'boolean' }).default(false),
  adminRoleId: text('admin_role_id').references(() => adminRoles.id, { onDelete: 'set null' }),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false),
  emailVerifyToken: text('email_verify_token'),
  emailVerifyExpires: integer('email_verify_expires', { mode: 'timestamp' }),
  passwordResetToken: text('password_reset_token'),
  passwordResetExpires: integer('password_reset_expires', { mode: 'timestamp' }),
  twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).default(false),
  twoFactorSecret: text('two_factor_secret'),
  twoFactorBackupCodes: text('two_factor_backup_codes', { mode: 'json' }).$type<string[] | null>(),
  securityChangedAt: integer('security_changed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const userAccounts = sqliteTable(
  'user_accounts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    accountId: text('account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').default('member'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex('user_accounts_user_account_idx').on(
      table.userId,
      table.accountId,
    ),
  ],
);

export const oauthProviders = sqliteTable(
  'oauth_providers',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    accessToken: text('access_token'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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
