import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { nodes } from './nodes.js';

export const nodeMetrics = mysqlTable('node_metrics', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  nodeId: varchar('node_id', { length: 36 }).references(() => nodes.id).notNull(),
  hostname: varchar('hostname', { length: 255 }).notNull(),
  cpuCount: int('cpu_count').notNull(),
  memTotal: bigint('mem_total', { mode: 'number' }).notNull(),
  memUsed: bigint('mem_used', { mode: 'number' }).notNull(),
  memFree: bigint('mem_free', { mode: 'number' }).notNull(),
  containerCount: int('container_count').notNull(),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

export const nodeMetricsRelations = relations(nodeMetrics, ({ one }) => ({
  node: one(nodes, { fields: [nodeMetrics.nodeId], references: [nodes.id] }),
}));
