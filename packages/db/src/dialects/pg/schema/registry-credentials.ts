import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const registryCredentials = pgTable('registry_credentials', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  registry: varchar('registry').notNull(),
  username: varchar('username').notNull(),
  password: text('password').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_registry_credentials_account_id').on(table.accountId),
]);

export const registryCredentialsRelations = relations(registryCredentials, ({ one }) => ({
  account: one(accounts, { fields: [registryCredentials.accountId], references: [accounts.id] }),
}));
