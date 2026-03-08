import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  json,
  datetime,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const platformSettings = mysqlTable('platform_settings', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: varchar('key', { length: 255 }).unique().notNull(),
  value: json('value').notNull(),
  updatedAt: datetime('updated_at').default(sql`(now())`),
});
