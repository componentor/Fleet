import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  timestamp,
} from 'drizzle-orm/mysql-core';

export const registryCredentials = mysqlTable('registry_credentials', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  registry: varchar('registry', { length: 255 }).notNull(),
  username: varchar('username', { length: 255 }).notNull(),
  password: text('password').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
