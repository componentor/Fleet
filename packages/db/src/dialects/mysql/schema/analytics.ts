import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { services } from './services';
import { accounts } from './accounts';

export const serviceAnalytics = mysqlTable('service_analytics', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: varchar('service_id', { length: 36 }).references(() => services.id, { onDelete: 'cascade' }).notNull(),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  requests: bigint('requests', { mode: 'number' }).default(0).notNull(),
  requests2xx: bigint('requests_2xx', { mode: 'number' }).default(0).notNull(),
  requests3xx: bigint('requests_3xx', { mode: 'number' }).default(0).notNull(),
  requests4xx: bigint('requests_4xx', { mode: 'number' }).default(0).notNull(),
  requests5xx: bigint('requests_5xx', { mode: 'number' }).default(0).notNull(),
  bytesIn: bigint('bytes_in', { mode: 'number' }).default(0).notNull(),
  bytesOut: bigint('bytes_out', { mode: 'number' }).default(0).notNull(),
  period: varchar('period', { length: 10 }).default('5m').notNull(),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
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
