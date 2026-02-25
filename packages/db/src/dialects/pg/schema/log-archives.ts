import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const logArchives = pgTable('log_archives', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  logType: varchar('log_type').notNull(),
  accountId: uuid('account_id'),
  dateFrom: timestamp('date_from').notNull(),
  dateTo: timestamp('date_to').notNull(),
  recordCount: integer('record_count').notNull().default(0),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).default(sql`0`),
  filePath: varchar('file_path').notNull(),
  filename: varchar('filename').notNull(),
  status: varchar('status').default('completed'),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
}, (table) => [
  index('idx_log_archives_log_type').on(table.logType),
  index('idx_log_archives_account_id').on(table.accountId),
  index('idx_log_archives_created_at').on(table.createdAt),
  index('idx_log_archives_expires_at').on(table.expiresAt),
]);
