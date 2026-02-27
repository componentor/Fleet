import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';

export const selfHealingJobs = pgTable('self_healing_jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  prompt: text('prompt').notNull(),
  status: varchar('status').default('pending').notNull(),
  baseBranch: varchar('base_branch'),
  workingBranch: varchar('working_branch'),
  prUrl: varchar('pr_url'),
  prNumber: integer('pr_number'),
  commitSha: varchar('commit_sha'),
  releaseTag: varchar('release_tag'),
  ciStatus: varchar('ci_status'),
  dockerServiceId: varchar('docker_service_id'),
  containerId: varchar('container_id'),
  log: text('log').default(''),
  options: jsonb('options').default({}).notNull(),
  error: text('error'),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
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
