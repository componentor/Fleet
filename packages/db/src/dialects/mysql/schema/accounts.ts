import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  int,
  json,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { sql, relations } from 'drizzle-orm';

export const accounts = mysqlTable('accounts', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }),
  slug: varchar('slug', { length: 255 }).unique(),
  parentId: varchar('parent_id', { length: 36 }),
  path: text('path'),
  depth: int('depth').default(0),
  trustRevocable: boolean('trust_revocable').default(false),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeConnectAccountId: varchar('stripe_connect_account_id', { length: 255 }),
  currency: varchar('currency', { length: 3 }).default('USD'),
  plan: json('plan'),
  status: varchar('status', { length: 255 }).default('active'),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
  suspendedAt: datetime('suspended_at'),
  scheduledDeletionAt: datetime('scheduled_deletion_at'),
  deletedAt: datetime('deleted_at'),
}, (table) => [
  index('idx_accounts_deleted_at').on(table.deletedAt),
  index('idx_accounts_scheduled_deletion').on(table.scheduledDeletionAt),
]);

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  parent: one(accounts, {
    fields: [accounts.parentId],
    references: [accounts.id],
    relationName: 'parentChildren',
  }),
  children: many(accounts, {
    relationName: 'parentChildren',
  }),
}));
