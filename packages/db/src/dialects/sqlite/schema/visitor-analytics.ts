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

export const visitorAnalytics = sqliteTable('visitor_analytics', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: text('service_id').references(() => services.id, { onDelete: 'cascade' }).notNull(),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  uniqueVisitors: integer('unique_visitors').default(0).notNull(),
  pageViews: integer('page_views').default(0).notNull(),
  topPaths: text('top_paths', { mode: 'json' }).default(sql`'[]'`).notNull(),
  topReferrers: text('top_referrers', { mode: 'json' }).default(sql`'[]'`).notNull(),
  browsers: text('browsers', { mode: 'json' }).default(sql`'{}'`).notNull(),
  devices: text('devices', { mode: 'json' }).default(sql`'{}'`).notNull(),
  period: text('period').default('5m').notNull(),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => [
  index('idx_visitor_analytics_service_recorded').on(table.serviceId, table.recordedAt),
  index('idx_visitor_analytics_account_recorded').on(table.accountId, table.recordedAt),
  index('idx_visitor_analytics_recorded_at').on(table.recordedAt),
]);

export const visitorAnalyticsRelations = relations(visitorAnalytics, ({ one }) => ({
  service: one(services, { fields: [visitorAnalytics.serviceId], references: [services.id] }),
  account: one(accounts, { fields: [visitorAnalytics.accountId], references: [accounts.id] }),
}));
