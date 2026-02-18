import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const emailTemplates = sqliteTable('email_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').unique().notNull(),
  subject: text('subject').notNull(),
  bodyHtml: text('body_html').notNull(),
  variables: text('variables', { mode: 'json' }).$default(() => ([])),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const emailLog = sqliteTable('email_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateSlug: text('template_slug').notNull(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  status: text('status').default('queued'),
  sentAt: integer('sent_at', { mode: 'timestamp' }),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_email_log_account_id').on(table.accountId),
  index('idx_email_log_status').on(table.status),
]);
