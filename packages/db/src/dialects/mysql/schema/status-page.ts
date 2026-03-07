import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  json,
  datetime,
  int,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';

export const statusPosts = mysqlTable('status_posts', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  icon: varchar('icon', { length: 255 }).default('info').notNull(),
  severity: varchar('severity', { length: 255 }).default('info').notNull(),
  status: varchar('status', { length: 255 }).default('draft').notNull(),
  affectedServices: json('affected_services').default([]),
  publishedAt: datetime('published_at'),
  createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
}, (table) => [
  index('idx_status_posts_status').on(table.status),
  index('idx_status_posts_published_at').on(table.publishedAt),
]);

export const statusPostTranslations = mysqlTable('status_post_translations', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  postId: varchar('post_id', { length: 36 })
    .references(() => statusPosts.id, { onDelete: 'cascade' })
    .notNull(),
  locale: varchar('locale', { length: 10 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
}, (table) => [
  uniqueIndex('idx_status_post_translations_post_locale').on(table.postId, table.locale),
]);

export const uptimeSnapshots = mysqlTable('uptime_snapshots', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  service: varchar('service', { length: 255 }).notNull(),
  status: varchar('status', { length: 255 }).notNull(),
  responseMs: int('response_ms'),
  recordedAt: datetime('recorded_at').default(sql`(now())`),
}, (table) => [
  index('idx_uptime_snapshots_service_recorded').on(table.service, table.recordedAt),
]);

export const statusPostsRelations = relations(statusPosts, ({ one, many }) => ({
  author: one(users, {
    fields: [statusPosts.createdBy],
    references: [users.id],
  }),
  translations: many(statusPostTranslations),
}));

export const statusPostTranslationsRelations = relations(statusPostTranslations, ({ one }) => ({
  post: one(statusPosts, {
    fields: [statusPostTranslations.postId],
    references: [statusPosts.id],
  }),
}));
