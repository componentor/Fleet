import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  int,
  boolean,
  json,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const errorLog = mysqlTable('error_log', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  level: varchar('level', { length: 50 }).notNull(),
  message: text('message').notNull(),
  stack: text('stack'),
  method: varchar('method', { length: 10 }),
  path: varchar('path', { length: 500 }),
  statusCode: int('status_code'),
  userId: varchar('user_id', { length: 36 }),
  ip: varchar('ip', { length: 45 }),
  userAgent: text('user_agent'),
  metadata: json('metadata').$type<Record<string, unknown> | null>(),
  resolved: boolean('resolved').default(false),
  status: varchar('status', { length: 50 }).default('open'),
  selfHealingJobId: varchar('self_healing_job_id', { length: 36 }),
  createdAt: datetime('created_at').default(sql`(now())`),
}, (table) => [
  index('idx_error_log_created_at').on(table.createdAt),
  index('idx_error_log_level').on(table.level),
  index('idx_error_log_resolved').on(table.resolved),
  index('idx_error_log_status').on(table.status),
]);
