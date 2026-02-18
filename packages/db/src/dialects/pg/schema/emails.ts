import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const emailTemplates = pgTable('email_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: varchar('slug').unique().notNull(),
  subject: varchar('subject').notNull(),
  bodyHtml: text('body_html').notNull(),
  variables: jsonb('variables').default([]),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').default(true),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const emailLog = pgTable('email_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  templateSlug: varchar('template_slug').notNull(),
  toEmail: varchar('to_email').notNull(),
  subject: varchar('subject').notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  status: varchar('status').default('queued'),
  sentAt: timestamp('sent_at'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
});
