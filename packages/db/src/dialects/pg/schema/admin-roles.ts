import {
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const adminRoles = pgTable('admin_roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 255 }),
  permissions: jsonb('permissions').notNull().default({}),
  isBuiltin: boolean('is_builtin').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  uniqueIndex('admin_roles_name_idx').on(table.name),
]);
