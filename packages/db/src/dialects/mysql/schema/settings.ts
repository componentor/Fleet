import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';

export const platformSettings = mysqlTable('platform_settings', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: varchar('key', { length: 255 }).unique().notNull(),
  value: json('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
