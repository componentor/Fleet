import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  text,
  json,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts';
import { nodes } from './nodes';

export const storageClusters = mysqlTable('storage_clusters', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: varchar('provider', { length: 255 }).default('local').notNull(),
  objectProvider: varchar('object_provider', { length: 255 }).default('local').notNull(),
  status: varchar('status', { length: 255 }).default('inactive').notNull(),
  replicationFactor: int('replication_factor').default(3),
  config: json('config').$default(() => ({})),
  objectConfig: json('object_config').$default(() => ({})),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const storageClustersRelations = relations(storageClusters, ({ many }) => ({
  storageNodes: many(storageNodes),
}));

export const storageNodes = mysqlTable('storage_nodes', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  clusterId: varchar('cluster_id', { length: 36 }).references(() => storageClusters.id, { onDelete: 'cascade' }),
  nodeId: varchar('node_id', { length: 36 }).references(() => nodes.id, { onDelete: 'set null' }),
  hostname: varchar('hostname', { length: 255 }).notNull(),
  ipAddress: varchar('ip_address', { length: 255 }).notNull(),
  role: varchar('role', { length: 255 }).default('storage').notNull(),
  status: varchar('status', { length: 255 }).default('pending').notNull(),
  storagePathRoot: varchar('storage_path_root', { length: 255 }).default('/srv/fleet-storage'),
  capacityGb: int('capacity_gb'),
  usedGb: int('used_gb').default(0),
  lastHealthCheck: timestamp('last_health_check'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
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

export const storageVolumes = mysqlTable('storage_volumes', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  sizeGb: int('size_gb').notNull(),
  usedGb: int('used_gb').default(0),
  provider: varchar('provider', { length: 255 }).default('local').notNull(),
  providerVolumeId: varchar('provider_volume_id', { length: 255 }),
  mountPath: varchar('mount_path', { length: 255 }),
  replicaCount: int('replica_count').default(1),
  status: varchar('status', { length: 255 }).default('creating').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
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

export const storageMigrations = mysqlTable('storage_migrations', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  fromProvider: varchar('from_provider', { length: 255 }).notNull(),
  toProvider: varchar('to_provider', { length: 255 }).notNull(),
  status: varchar('status', { length: 255 }).default('pending').notNull(),
  progress: int('progress').default(0),
  totalBytes: bigint('total_bytes', { mode: 'number' }),
  migratedBytes: bigint('migrated_bytes', { mode: 'number' }).default(0),
  currentItem: varchar('current_item', { length: 255 }),
  log: text('log'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const storageMigrationsRelations = relations(storageMigrations, () => ({}));
