import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const adminRoles = sqliteTable('admin_roles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  permissions: text('permissions', { mode: 'json' }).notNull().default({}),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('admin_roles_name_idx').on(table.name),
]);
