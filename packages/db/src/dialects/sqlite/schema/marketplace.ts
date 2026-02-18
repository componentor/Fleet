import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const appTemplates = sqliteTable('app_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  iconUrl: text('icon_url'),
  category: text('category').default('other'),
  composeTemplate: text('compose_template').notNull(),
  variables: text('variables', { mode: 'json' }).$default(() => ([])),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).default(false),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
