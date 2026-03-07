import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { services } from './services';
import { accounts } from './accounts';

export const serviceAnalytics = sqliteTable('service_analytics', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: text('service_id').references(() => services.id, { onDelete: 'cascade' }).notNull(),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  requests: integer('requests').default(0).notNull(),
  requests2xx: integer('requests_2xx').default(0).notNull(),
  requests3xx: integer('requests_3xx').default(0).notNull(),
  requests4xx: integer('requests_4xx').default(0).notNull(),
  requests5xx: integer('requests_5xx').default(0).notNull(),
  bytesIn: integer('bytes_in').default(0).notNull(),
  bytesOut: integer('bytes_out').default(0).notNull(),
  avgResponseTimeMs: integer('avg_response_time_ms').default(0).notNull(),
  p95ResponseTimeMs: integer('p95_response_time_ms').default(0).notNull(),
  ioReadBytes: integer('io_read_bytes').default(0).notNull(),
  ioWriteBytes: integer('io_write_bytes').default(0).notNull(),
  period: text('period').default('5m').notNull(),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => [
  index('idx_service_analytics_service_recorded').on(table.serviceId, table.recordedAt),
  index('idx_service_analytics_account_recorded').on(table.accountId, table.recordedAt),
  index('idx_service_analytics_recorded_at').on(table.recordedAt),
  index('idx_service_analytics_period_recorded').on(table.period, table.recordedAt),
]);

export const serviceAnalyticsRelations = relations(serviceAnalytics, ({ one }) => ({
  service: one(services, { fields: [serviceAnalytics.serviceId], references: [services.id] }),
  account: one(accounts, { fields: [serviceAnalytics.accountId], references: [accounts.id] }),
}));
