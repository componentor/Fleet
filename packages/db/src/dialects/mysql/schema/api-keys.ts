import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  json,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { sql, relations } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';

export const apiKeys = mysqlTable('api_keys', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
  scopes: json('scopes').$default(() => ['*']),
  lastUsedAt: datetime('last_used_at'),
  expiresAt: datetime('expires_at'),
  createdAt: datetime('created_at').default(sql`(now())`),
}, (table) => [
  index('idx_api_keys_account_id').on(table.accountId),
]);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  account: one(accounts, { fields: [apiKeys.accountId], references: [accounts.id] }),
  creator: one(users, { fields: [apiKeys.createdBy], references: [users.id] }),
}));
