import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import { users } from './users';
import { accounts } from './accounts';

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  action: varchar('action').notNull(),
  eventType: varchar('event_type'),
  description: varchar('description'),
  resourceType: varchar('resource_type'),
  resourceId: uuid('resource_id'),
  resourceName: varchar('resource_name'),
  actorEmail: varchar('actor_email'),
  ipAddress: varchar('ip_address'),
  source: varchar('source').default('user'),
  details: jsonb('details').default({}),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_audit_log_account_id').on(table.accountId),
  index('idx_audit_log_created_at').on(table.createdAt),
  index('idx_audit_log_event_type').on(table.eventType),
]);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
  account: one(accounts, { fields: [auditLog.accountId], references: [accounts.id] }),
}));
