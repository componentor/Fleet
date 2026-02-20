import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }),
  slug: varchar('slug', { length: 255 }).unique(),
  parentId: uuid('parent_id'),
  path: text('path'),
  depth: integer('depth').default(0),
  trustRevocable: boolean('trust_revocable').default(false),
  stripeCustomerId: varchar('stripe_customer_id'),
  stripeConnectAccountId: varchar('stripe_connect_account_id'),
  plan: jsonb('plan'),
  status: varchar('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  scheduledDeletionAt: timestamp('scheduled_deletion_at'),
  deletedAt: timestamp('deleted_at'),
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
