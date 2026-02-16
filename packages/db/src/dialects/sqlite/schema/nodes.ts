import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  hostname: text('hostname').notNull(),
  ipAddress: text('ip_address').notNull(),
  dockerNodeId: text('docker_node_id'),
  role: text('role').default('worker'),
  status: text('status').default('active'),
  labels: text('labels', { mode: 'json' }).$default(() => ({})),
  nfsServer: integer('nfs_server', { mode: 'boolean' }).default(false),
  lastHeartbeat: integer('last_heartbeat', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const nodesRelations = relations(nodes, () => ({}));
