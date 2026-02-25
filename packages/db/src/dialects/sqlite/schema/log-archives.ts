import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const logArchives = sqliteTable('log_archives', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  logType: text('log_type').notNull(),
  accountId: text('account_id'),
  dateFrom: integer('date_from', { mode: 'timestamp' }).notNull(),
  dateTo: integer('date_to', { mode: 'timestamp' }).notNull(),
  recordCount: integer('record_count').notNull().default(0),
  sizeBytes: integer('size_bytes').default(0),
  filePath: text('file_path').notNull(),
  filename: text('filename').notNull(),
  status: text('status').default('completed'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
}, (table) => [
  index('idx_log_archives_log_type').on(table.logType),
  index('idx_log_archives_account_id').on(table.accountId),
  index('idx_log_archives_created_at').on(table.createdAt),
  index('idx_log_archives_expires_at').on(table.expiresAt),
]);
