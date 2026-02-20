import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { nodes } from './nodes';

export const storageClusters = sqliteTable('storage_clusters', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider').default('local').notNull(),
  objectProvider: text('object_provider').default('local').notNull(),
  status: text('status').default('inactive').notNull(),
  replicationFactor: integer('replication_factor').default(3),
  config: text('config', { mode: 'json' }).$default(() => ({})),
  objectConfig: text('object_config', { mode: 'json' }).$default(() => ({})),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const storageClustersRelations = relations(storageClusters, ({ many }) => ({
  storageNodes: many(storageNodes),
}));

export const storageNodes = sqliteTable('storage_nodes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  clusterId: text('cluster_id').references(() => storageClusters.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').references(() => nodes.id, { onDelete: 'set null' }),
  hostname: text('hostname').notNull(),
  ipAddress: text('ip_address').notNull(),
  role: text('role').default('storage').notNull(),
  status: text('status').default('pending').notNull(),
  storagePathRoot: text('storage_path_root').default('/srv/fleet-storage'),
  capacityGb: integer('capacity_gb'),
  usedGb: integer('used_gb').default(0),
  lastHealthCheck: integer('last_health_check', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('storage_nodes_cluster_idx').on(table.clusterId),
  index('idx_storage_nodes_last_health_check').on(table.lastHealthCheck),
]);

export const storageNodesRelations = relations(storageNodes, ({ one }) => ({
  cluster: one(storageClusters, {
    fields: [storageNodes.clusterId],
    references: [storageClusters.id],
  }),
  node: one(nodes, {
    fields: [storageNodes.nodeId],
    references: [nodes.id],
  }),
}));

export const storageVolumes = sqliteTable('storage_volumes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  displayName: text('display_name'),
  sizeGb: integer('size_gb').notNull(),
  usedGb: integer('used_gb').default(0),
  provider: text('provider').default('local').notNull(),
  providerVolumeId: text('provider_volume_id'),
  mountPath: text('mount_path'),
  replicaCount: integer('replica_count').default(1),
  status: text('status').default('creating').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
}, (table) => [
  index('storage_volumes_account_idx').on(table.accountId),
  index('idx_storage_volumes_deleted_at').on(table.deletedAt),
]);

export const storageVolumesRelations = relations(storageVolumes, ({ one }) => ({
  account: one(accounts, {
    fields: [storageVolumes.accountId],
    references: [accounts.id],
  }),
}));

export const storageMigrations = sqliteTable('storage_migrations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fromProvider: text('from_provider').notNull(),
  toProvider: text('to_provider').notNull(),
  status: text('status').default('pending').notNull(),
  progress: integer('progress').default(0),
  totalBytes: integer('total_bytes'),
  migratedBytes: integer('migrated_bytes').default(0),
  currentItem: text('current_item'),
  log: text('log'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const storageMigrationsRelations = relations(storageMigrations, () => ({}));
