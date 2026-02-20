import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const errorLog = sqliteTable('error_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  level: text('level').notNull(),
  message: text('message').notNull(),
  stack: text('stack'),
  method: text('method'),
  path: text('path'),
  statusCode: integer('status_code'),
  userId: text('user_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  resolved: integer('resolved', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_error_log_created_at').on(table.createdAt),
  index('idx_error_log_level').on(table.level),
  index('idx_error_log_resolved').on(table.resolved),
]);
