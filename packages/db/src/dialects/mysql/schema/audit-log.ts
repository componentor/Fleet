import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  json,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { sql, relations } from 'drizzle-orm';
import { users } from './users';
import { accounts } from './accounts';

export const auditLog = mysqlTable('audit_log', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 255 }).notNull(),
  eventType: varchar('event_type', { length: 255 }),
  description: varchar('description', { length: 500 }),
  resourceType: varchar('resource_type', { length: 255 }),
  resourceId: varchar('resource_id', { length: 36 }),
  resourceName: varchar('resource_name', { length: 255 }),
  actorEmail: varchar('actor_email', { length: 255 }),
  ipAddress: varchar('ip_address', { length: 255 }),
  source: varchar('source', { length: 50 }).default('user'),
  details: json('details').$default(() => ({})),
  createdAt: datetime('created_at').default(sql`(now())`),
}, (table) => [
  index('idx_audit_log_account_id').on(table.accountId),
  index('idx_audit_log_created_at').on(table.createdAt),
  index('idx_audit_log_event_type').on(table.eventType),
]);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
  account: one(accounts, { fields: [auditLog.accountId], references: [accounts.id] }),
}));
