import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  int,
  json,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { sql, relations } from 'drizzle-orm';
import { users } from './users';

export const selfHealingJobs = mysqlTable('self_healing_jobs', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  prompt: text('prompt').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  baseBranch: varchar('base_branch', { length: 255 }),
  workingBranch: varchar('working_branch', { length: 255 }),
  prUrl: varchar('pr_url', { length: 500 }),
  prNumber: int('pr_number'),
  commitSha: varchar('commit_sha', { length: 255 }),
  releaseTag: varchar('release_tag', { length: 100 }),
  ciStatus: varchar('ci_status', { length: 50 }),
  dockerServiceId: varchar('docker_service_id', { length: 255 }),
  containerId: varchar('container_id', { length: 255 }),
  log: text('log'),
  options: json('options').default({}).notNull(),
  error: text('error'),
  createdBy: varchar('created_by', { length: 36 })
    .references(() => users.id, { onDelete: 'set null' }),
  startedAt: datetime('started_at'),
  completedAt: datetime('completed_at'),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
}, (table) => [
  index('idx_self_healing_jobs_status').on(table.status),
  index('idx_self_healing_jobs_created_by').on(table.createdBy),
  index('idx_self_healing_jobs_created_at').on(table.createdAt),
]);

export const selfHealingJobsRelations = relations(selfHealingJobs, ({ one }) => ({
  creator: one(users, {
    fields: [selfHealingJobs.createdBy],
    references: [users.id],
  }),
}));
