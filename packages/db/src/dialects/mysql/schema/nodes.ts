import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';

export const nodes = mysqlTable('nodes', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  hostname: varchar('hostname', { length: 255 }).notNull(),
  ipAddress: varchar('ip_address', { length: 255 }).notNull(),
  dockerNodeId: varchar('docker_node_id', { length: 255 }),
  role: varchar('role', { length: 255 }).default('worker'),
  status: varchar('status', { length: 255 }).default('active'),
  labels: json('labels').$default(() => ({})),
  nfsServer: boolean('nfs_server').default(false),
  lastHeartbeat: timestamp('last_heartbeat'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const nodesRelations = relations(nodes, () => ({}));
