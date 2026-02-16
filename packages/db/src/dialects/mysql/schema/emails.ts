import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { accounts } from './accounts.js';

export const emailTemplates = mysqlTable('email_templates', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  bodyHtml: text('body_html').notNull(),
  variables: json('variables').$default(() => ([])),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id),
  enabled: boolean('enabled').default(true),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const emailLog = mysqlTable('email_log', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateSlug: varchar('template_slug', { length: 255 }).notNull(),
  toEmail: varchar('to_email', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id),
  status: varchar('status', { length: 255 }).default('queued'),
  sentAt: timestamp('sent_at'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
});
