import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { users } from './users';
import { accounts } from './accounts';

export const auditLog = mysqlTable('audit_log', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: varchar('user_id', { length: 36 }).references(() => users.id),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id),
  action: varchar('action', { length: 255 }).notNull(),
  resourceType: varchar('resource_type', { length: 255 }),
  resourceId: varchar('resource_id', { length: 36 }),
  ipAddress: varchar('ip_address', { length: 255 }),
  details: json('details').$default(() => ({})),
  createdAt: timestamp('created_at').defaultNow(),
});
