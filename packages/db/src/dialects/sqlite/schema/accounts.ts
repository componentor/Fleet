import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  slug: text('slug').unique(),
  parentId: text('parent_id'),
  path: text('path'),
  depth: integer('depth').default(0),
  trustRevocable: integer('trust_revocable', { mode: 'boolean' }).default(false),
  stripeCustomerId: text('stripe_customer_id'),
  stripeConnectAccountId: text('stripe_connect_account_id'),
  plan: text('plan', { mode: 'json' }),
  status: text('status').default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  suspendedAt: integer('suspended_at', { mode: 'timestamp' }),
  scheduledDeletionAt: integer('scheduled_deletion_at', { mode: 'timestamp' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
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
