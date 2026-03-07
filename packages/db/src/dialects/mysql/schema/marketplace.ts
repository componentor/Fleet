import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  json,
  datetime,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const appTemplates = mysqlTable('app_templates', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  iconUrl: varchar('icon_url', { length: 255 }),
  category: varchar('category', { length: 255 }).default('other'),
  composeTemplate: text('compose_template').notNull(),
  variables: json('variables').$default(() => ([])),
  isBuiltin: boolean('is_builtin').default(false),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'set null' }),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
});
