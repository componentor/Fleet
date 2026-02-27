import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const errorLog = pgTable('error_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  level: varchar('level').notNull(),
  message: text('message').notNull(),
  stack: text('stack'),
  method: varchar('method'),
  path: varchar('path'),
  statusCode: integer('status_code'),
  userId: uuid('user_id'),
  ip: varchar('ip'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
  resolved: boolean('resolved').default(false),
  status: varchar('status').default('open'),
  selfHealingJobId: uuid('self_healing_job_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_error_log_created_at').on(table.createdAt),
  index('idx_error_log_level').on(table.level),
  index('idx_error_log_resolved').on(table.resolved),
  index('idx_error_log_status').on(table.status),
]);
