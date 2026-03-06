import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const stacks = sqliteTable('stacks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name'),
  templateSlug: text('template_slug'),
  status: text('status').default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
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
