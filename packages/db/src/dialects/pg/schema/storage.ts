import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { nodes } from './nodes';

export const storageClusters = pgTable('storage_clusters', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar('provider').default('local').notNull(),
  objectProvider: varchar('object_provider').default('local').notNull(),
  status: varchar('status').default('inactive').notNull(),
  replicationFactor: integer('replication_factor').default(3),
  config: jsonb('config').default({}),
  objectConfig: jsonb('object_config').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const storageClustersRelations = relations(storageClusters, ({ many }) => ({
  storageNodes: many(storageNodes),
}));

export const storageNodes = pgTable('storage_nodes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clusterId: uuid('cluster_id').references(() => storageClusters.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'set null' }),
  hostname: varchar('hostname').notNull(),
  ipAddress: varchar('ip_address').notNull(),
  role: varchar('role').default('storage').notNull(),
  status: varchar('status').default('pending').notNull(),
  storagePathRoot: varchar('storage_path_root').default('/srv/fleet-storage'),
  capacityGb: integer('capacity_gb'),
  usedGb: integer('used_gb').default(0),
  lastHealthCheck: timestamp('last_health_check'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('storage_nodes_cluster_idx').on(table.clusterId),
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

export const storageVolumes = pgTable('storage_volumes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name').notNull(),
  displayName: varchar('display_name'),
  sizeGb: integer('size_gb').notNull(),
  usedGb: integer('used_gb').default(0),
  provider: varchar('provider').default('local').notNull(),
  providerVolumeId: varchar('provider_volume_id'),
  mountPath: varchar('mount_path'),
  replicaCount: integer('replica_count').default(1),
  status: varchar('status').default('creating').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('storage_volumes_account_idx').on(table.accountId),
]);

export const storageVolumesRelations = relations(storageVolumes, ({ one }) => ({
  account: one(accounts, {
    fields: [storageVolumes.accountId],
    references: [accounts.id],
  }),
}));

export const storageMigrations = pgTable('storage_migrations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  fromProvider: varchar('from_provider').notNull(),
  toProvider: varchar('to_provider').notNull(),
  status: varchar('status').default('pending').notNull(),
  progress: integer('progress').default(0),
  totalBytes: bigint('total_bytes', { mode: 'number' }),
  migratedBytes: bigint('migrated_bytes', { mode: 'number' }).default(0),
  currentItem: varchar('current_item'),
  log: text('log'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const storageMigrationsRelations = relations(storageMigrations, () => ({}));
