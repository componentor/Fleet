import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name').notNull(),
  keyPrefix: varchar('key_prefix').notNull(),
  keyHash: varchar('key_hash').notNull().unique(),
  scopes: jsonb('scopes').default(['*']),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_api_keys_account_id').on(table.accountId),
]);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  account: one(accounts, { fields: [apiKeys.accountId], references: [accounts.id] }),
  creator: one(users, { fields: [apiKeys.createdBy], references: [users.id] }),
}));
