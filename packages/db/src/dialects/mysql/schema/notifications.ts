import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';

export const notifications = mysqlTable('notifications', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  userId: varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 255 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: varchar('message', { length: 2000 }).notNull(),
  resourceType: varchar('resource_type', { length: 255 }),
  resourceId: varchar('resource_id', { length: 36 }),
  read: boolean('read').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_notifications_account_id').on(table.accountId),
  index('idx_notifications_user_id').on(table.userId),
]);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  account: one(accounts, { fields: [notifications.accountId], references: [accounts.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
