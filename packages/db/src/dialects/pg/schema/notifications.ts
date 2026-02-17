import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  type: varchar('type').notNull(),
  title: varchar('title').notNull(),
  message: varchar('message').notNull(),
  resourceType: varchar('resource_type'),
  resourceId: uuid('resource_id'),
  read: boolean('read').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  account: one(accounts, { fields: [notifications.accountId], references: [accounts.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
