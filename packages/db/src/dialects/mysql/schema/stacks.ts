import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts';

export const stacks = mysqlTable('stacks', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }),
  templateSlug: varchar('template_slug', { length: 255 }),
  status: varchar('status', { length: 255 }).default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('idx_stacks_account_id').on(table.accountId),
  index('idx_stacks_deleted_at').on(table.deletedAt),
]);

export const stacksRelations = relations(stacks, ({ one }) => ({
  account: one(accounts, {
    fields: [stacks.accountId],
    references: [accounts.id],
  }),
}));
