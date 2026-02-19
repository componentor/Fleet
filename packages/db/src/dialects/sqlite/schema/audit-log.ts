import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql, relations } from 'drizzle-orm';
import { users } from './users';
import { accounts } from './accounts';

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  eventType: text('event_type'),
  description: text('description'),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  resourceName: text('resource_name'),
  actorEmail: text('actor_email'),
  ipAddress: text('ip_address'),
  source: text('source').default('user'),
  details: text('details', { mode: 'json' }).$default(() => ({})),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_audit_log_account_id').on(table.accountId),
  index('idx_audit_log_created_at').on(table.createdAt),
  index('idx_audit_log_event_type').on(table.eventType),
]);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
  account: one(accounts, { fields: [auditLog.accountId], references: [accounts.id] }),
}));
