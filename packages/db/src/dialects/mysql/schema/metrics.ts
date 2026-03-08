import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { sql, relations } from 'drizzle-orm';
import { nodes } from './nodes';

export const nodeMetrics = mysqlTable('node_metrics', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  nodeId: varchar('node_id', { length: 36 }).references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  hostname: varchar('hostname', { length: 255 }).notNull(),
  cpuCount: int('cpu_count').notNull(),
  memTotal: bigint('mem_total', { mode: 'number' }).notNull(),
  memUsed: bigint('mem_used', { mode: 'number' }).notNull(),
  memFree: bigint('mem_free', { mode: 'number' }).notNull(),
  containerCount: int('container_count').notNull(),
  diskTotal: bigint('disk_total', { mode: 'number' }).default(0).notNull(),
  diskUsed: bigint('disk_used', { mode: 'number' }).default(0).notNull(),
  diskFree: bigint('disk_free', { mode: 'number' }).default(0).notNull(),
  diskType: varchar('disk_type', { length: 20 }).default('unknown').notNull(),
  recordedAt: datetime('recorded_at').default(sql`(now())`),
}, (table) => [
  index('idx_node_metrics_node_id').on(table.nodeId),
  index('idx_node_metrics_node_recorded').on(table.nodeId, table.recordedAt),
]);

export const nodeMetricsRelations = relations(nodeMetrics, ({ one }) => ({
  node: one(nodes, { fields: [nodeMetrics.nodeId], references: [nodes.id] }),
}));
