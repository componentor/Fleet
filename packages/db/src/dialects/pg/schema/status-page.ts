import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';

export const statusPosts = pgTable('status_posts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  icon: varchar('icon').default('info').notNull(),
  severity: varchar('severity').default('info').notNull(),
  status: varchar('status').default('draft').notNull(),
  affectedServices: jsonb('affected_services').default([]),
  publishedAt: timestamp('published_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_status_posts_status').on(table.status),
  index('idx_status_posts_published_at').on(table.publishedAt),
]);

export const statusPostTranslations = pgTable('status_post_translations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  postId: uuid('post_id')
    .references(() => statusPosts.id, { onDelete: 'cascade' })
    .notNull(),
  locale: varchar('locale').notNull(),
  title: varchar('title').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  uniqueIndex('idx_status_post_translations_post_locale').on(table.postId, table.locale),
]);

export const uptimeSnapshots = pgTable('uptime_snapshots', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  service: varchar('service').notNull(),
  status: varchar('status').notNull(),
  responseMs: integer('response_ms'),
  recordedAt: timestamp('recorded_at').defaultNow(),
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
