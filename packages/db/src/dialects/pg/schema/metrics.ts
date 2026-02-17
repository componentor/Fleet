import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { nodes } from './nodes';

export const nodeMetrics = pgTable('node_metrics', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  nodeId: uuid('node_id').references(() => nodes.id).notNull(),
  hostname: varchar('hostname').notNull(),
  cpuCount: integer('cpu_count').notNull(),
  memTotal: bigint('mem_total', { mode: 'number' }).notNull(),
  memUsed: bigint('mem_used', { mode: 'number' }).notNull(),
  memFree: bigint('mem_free', { mode: 'number' }).notNull(),
  containerCount: integer('container_count').notNull(),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

export const nodeMetricsRelations = relations(nodeMetrics, ({ one }) => ({
  node: one(nodes, { fields: [nodeMetrics.nodeId], references: [nodes.id] }),
}));
