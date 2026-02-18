import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { nodes } from './nodes';

export const nodeMetrics = sqliteTable('node_metrics', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  nodeId: text('node_id').references(() => nodes.id, { onDelete: 'cascade' }).notNull(),
  hostname: text('hostname').notNull(),
  cpuCount: integer('cpu_count').notNull(),
  memTotal: integer('mem_total').notNull(),
  memUsed: integer('mem_used').notNull(),
  memFree: integer('mem_free').notNull(),
  containerCount: integer('container_count').notNull(),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_node_metrics_node_id').on(table.nodeId),
  index('idx_node_metrics_node_recorded').on(table.nodeId, table.recordedAt),
]);

export const nodeMetricsRelations = relations(nodeMetrics, ({ one }) => ({
  node: one(nodes, { fields: [nodeMetrics.nodeId], references: [nodes.id] }),
}));
