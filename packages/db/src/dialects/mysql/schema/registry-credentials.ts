import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts';

export const registryCredentials = mysqlTable('registry_credentials', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  registry: varchar('registry', { length: 255 }).notNull(),
  username: varchar('username', { length: 255 }).notNull(),
  password: text('password').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_registry_credentials_account_id').on(table.accountId),
]);

export const registryCredentialsRelations = relations(registryCredentials, ({ one }) => ({
  account: one(accounts, { fields: [registryCredentials.accountId], references: [accounts.id] }),
}));
