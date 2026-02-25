import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const registryCredentials = sqliteTable('registry_credentials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  registry: text('registry').notNull(),
  username: text('username').notNull(),
  password: text('password').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_registry_credentials_account_id').on(table.accountId),
]);

export const registryCredentialsRelations = relations(registryCredentials, ({ one }) => ({
  account: one(accounts, { fields: [registryCredentials.accountId], references: [accounts.id] }),
}));
