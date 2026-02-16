import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const platformSettings = sqliteTable('platform_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text('key').unique().notNull(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
