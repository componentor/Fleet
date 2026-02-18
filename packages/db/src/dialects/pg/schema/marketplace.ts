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

export const appTemplates = pgTable('app_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: varchar('slug').unique().notNull(),
  name: varchar('name').notNull(),
  description: text('description').default(''),
  iconUrl: varchar('icon_url'),
  category: varchar('category').default('other'),
  composeTemplate: text('compose_template').notNull(),
  variables: jsonb('variables').default([]),
  isBuiltin: boolean('is_builtin').default(false),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
