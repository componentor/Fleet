import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { accounts } from './accounts';

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').references(() => users.id),
  accountId: uuid('account_id').references(() => accounts.id),
  action: varchar('action').notNull(),
  resourceType: varchar('resource_type'),
  resourceId: uuid('resource_id'),
  ipAddress: varchar('ip_address'),
  details: jsonb('details').default({}),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_audit_log_account_id').on(table.accountId),
  index('idx_audit_log_created_at').on(table.createdAt),
]);
