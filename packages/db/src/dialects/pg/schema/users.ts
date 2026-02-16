import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts.js';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: varchar('email', { length: 255 }).unique(),
  passwordHash: varchar('password_hash'),
  name: varchar('name', { length: 255 }),
  avatarUrl: varchar('avatar_url'),
  isSuper: boolean('is_super').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const userAccounts = pgTable(
  'user_accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    accountId: uuid('account_id')
      .references(() => accounts.id)
      .notNull(),
    role: varchar('role').default('member'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('user_accounts_user_account_idx').on(
      table.userId,
      table.accountId,
    ),
  ],
);

export const oauthProviders = pgTable(
  'oauth_providers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    provider: varchar('provider').notNull(),
    providerUserId: varchar('provider_user_id').notNull(),
    accessToken: varchar('access_token'),
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
