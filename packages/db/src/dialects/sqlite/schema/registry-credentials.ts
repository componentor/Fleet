import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const registryCredentials = sqliteTable('registry_credentials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  registry: text('registry').notNull(),
  username: text('username').notNull(),
  password: text('password').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
