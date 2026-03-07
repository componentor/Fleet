import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const logArchives = mysqlTable('log_archives', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  logType: varchar('log_type', { length: 50 }).notNull(),
  accountId: varchar('account_id', { length: 36 }),
  dateFrom: datetime('date_from').notNull(),
  dateTo: datetime('date_to').notNull(),
  recordCount: int('record_count').notNull().default(0),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).default(0),
  filePath: varchar('file_path', { length: 500 }).notNull(),
  filename: varchar('filename', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).default('completed'),
  createdAt: datetime('created_at').default(sql`(now())`),
  expiresAt: datetime('expires_at'),
}, (table) => [
  index('idx_log_archives_log_type').on(table.logType),
  index('idx_log_archives_account_id').on(table.accountId),
  index('idx_log_archives_created_at').on(table.createdAt),
  index('idx_log_archives_expires_at').on(table.expiresAt),
]);
