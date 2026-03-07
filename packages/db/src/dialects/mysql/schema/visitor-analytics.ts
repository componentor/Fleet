import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  bigint,
  timestamp,
  json,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { services } from './services';
import { accounts } from './accounts';

export const visitorAnalytics = mysqlTable('visitor_analytics', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: varchar('service_id', { length: 36 }).references(() => services.id, { onDelete: 'cascade' }).notNull(),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  uniqueVisitors: bigint('unique_visitors', { mode: 'number' }).default(0).notNull(),
  pageViews: bigint('page_views', { mode: 'number' }).default(0).notNull(),
  topPaths: json('top_paths').default([]).notNull(),
  topReferrers: json('top_referrers').default([]).notNull(),
  browsers: json('browsers').default({}).notNull(),
  devices: json('devices').default({}).notNull(),
  period: varchar('period', { length: 10 }).default('5m').notNull(),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
}, (table) => [
  index('idx_visitor_analytics_service_recorded').on(table.serviceId, table.recordedAt),
  index('idx_visitor_analytics_account_recorded').on(table.accountId, table.recordedAt),
  index('idx_visitor_analytics_recorded_at').on(table.recordedAt),
]);

export const visitorAnalyticsRelations = relations(visitorAnalytics, ({ one }) => ({
  service: one(services, { fields: [visitorAnalytics.serviceId], references: [services.id] }),
  account: one(accounts, { fields: [visitorAnalytics.accountId], references: [accounts.id] }),
}));
