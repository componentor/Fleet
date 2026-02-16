import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts.js';

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: varchar('email', { length: 255 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  name: varchar('name', { length: 255 }),
  avatarUrl: varchar('avatar_url', { length: 255 }),
  isSuper: boolean('is_super').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const userAccounts = mysqlTable(
  'user_accounts',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: varchar('user_id', { length: 36 })
      .references(() => users.id)
      .notNull(),
    accountId: varchar('account_id', { length: 36 })
      .references(() => accounts.id)
      .notNull(),
    role: varchar('role', { length: 255 }).default('member'),
    createdAt: timestamp('created_at').defaultNow(),
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
      .references(() => users.id)
      .notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    accessToken: varchar('access_token', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('oauth_provider_user_idx').on(
      table.provider,
      table.providerUserId,
    ),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
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
