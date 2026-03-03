import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  json,
  timestamp,
  index,
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
  location: varchar('location', { length: 255 }),
  nfsServer: boolean('nfs_server').default(false),
  sshAllowedIps: json('ssh_allowed_ips'),
  lastHeartbeat: timestamp('last_heartbeat'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_nodes_last_heartbeat').on(table.lastHeartbeat),
]);

export const nodesRelations = relations(nodes, () => ({}));
