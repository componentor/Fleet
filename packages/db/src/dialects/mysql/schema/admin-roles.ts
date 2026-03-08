import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  json,
  datetime,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const adminRoles = mysqlTable('admin_roles', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 255 }),
  permissions: json('permissions').notNull().default({}),
  isBuiltin: boolean('is_builtin').default(false),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
}, (table) => [
  uniqueIndex('admin_roles_name_idx').on(table.name),
]);
