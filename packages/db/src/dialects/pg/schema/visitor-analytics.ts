import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { services } from './services';
import { accounts } from './accounts';

export const visitorAnalytics = pgTable('visitor_analytics', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  uniqueVisitors: bigint('unique_visitors', { mode: 'number' }).default(0).notNull(),
  pageViews: bigint('page_views', { mode: 'number' }).default(0).notNull(),
  topPaths: jsonb('top_paths').default(sql`'[]'`).notNull(),
  topReferrers: jsonb('top_referrers').default(sql`'[]'`).notNull(),
  browsers: jsonb('browsers').default(sql`'{}'`).notNull(),
  devices: jsonb('devices').default(sql`'{}'`).notNull(),
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
