import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';

export const statusPosts = sqliteTable('status_posts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  icon: text('icon').default('info').notNull(),
  severity: text('severity').default('info').notNull(),
  status: text('status').default('draft').notNull(),
  affectedServices: text('affected_services', { mode: 'json' }).$default(() => ([])),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_status_posts_status').on(table.status),
  index('idx_status_posts_published_at').on(table.publishedAt),
]);

export const statusPostTranslations = sqliteTable('status_post_translations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  postId: text('post_id')
    .references(() => statusPosts.id, { onDelete: 'cascade' })
    .notNull(),
  locale: text('locale').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('idx_status_post_translations_post_locale').on(table.postId, table.locale),
]);

export const uptimeSnapshots = sqliteTable('uptime_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  service: text('service').notNull(),
  status: text('status').notNull(),
  responseMs: integer('response_ms'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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
