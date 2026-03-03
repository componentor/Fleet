import {
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  hostname: varchar('hostname').notNull(),
  ipAddress: varchar('ip_address').notNull(),
  dockerNodeId: varchar('docker_node_id'),
  role: varchar('role').default('worker'),
  status: varchar('status').default('active'),
  labels: jsonb('labels').default({}),
  location: varchar('location'),
  nfsServer: boolean('nfs_server').default(false),
  sshAllowedIps: jsonb('ssh_allowed_ips'),
  lastHeartbeat: timestamp('last_heartbeat'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_nodes_last_heartbeat').on(table.lastHeartbeat),
]);

export const nodesRelations = relations(nodes, () => ({}));
