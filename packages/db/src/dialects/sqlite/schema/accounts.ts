import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
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
  scheduledDeletionAt: integer('scheduled_deletion_at', { mode: 'timestamp' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

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
