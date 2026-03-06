import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const stacks = pgTable('stacks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name'),
  templateSlug: varchar('template_slug'),
  status: varchar('status').default('active'),
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
