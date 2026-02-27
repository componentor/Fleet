import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';

export const selfHealingJobs = sqliteTable('self_healing_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  prompt: text('prompt').notNull(),
  status: text('status').default('pending').notNull(),
  baseBranch: text('base_branch'),
  workingBranch: text('working_branch'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  commitSha: text('commit_sha'),
  releaseTag: text('release_tag'),
  ciStatus: text('ci_status'),
  dockerServiceId: text('docker_service_id'),
  containerId: text('container_id'),
  log: text('log').default(''),
  options: text('options', { mode: 'json' }).default('{}').notNull(),
  error: text('error'),
  createdBy: text('created_by')
    .references(() => users.id, { onDelete: 'set null' }),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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
