import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { accounts } from './accounts';

export const supportTickets = mysqlTable('support_tickets', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  subject: varchar('subject', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).default('open').notNull(),
  priority: varchar('priority', { length: 50 }).default('normal').notNull(),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  createdBy: varchar('created_by', { length: 36 })
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  assignedTo: varchar('assigned_to', { length: 36 })
    .references(() => users.id, { onDelete: 'set null' }),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_support_tickets_account_id').on(table.accountId),
  index('idx_support_tickets_status').on(table.status),
  index('idx_support_tickets_assigned_to').on(table.assignedTo),
  index('idx_support_tickets_created_by').on(table.createdBy),
]);

export const supportTicketMessages = mysqlTable('support_ticket_messages', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  ticketId: varchar('ticket_id', { length: 36 })
    .references(() => supportTickets.id, { onDelete: 'cascade' })
    .notNull(),
  authorId: varchar('author_id', { length: 36 })
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  body: text('body').notNull(),
  isInternal: boolean('is_internal').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_support_ticket_messages_ticket_id').on(table.ticketId),
]);

export const supportTicketsRelations = relations(supportTickets, ({ one, many }) => ({
  account: one(accounts, {
    fields: [supportTickets.accountId],
    references: [accounts.id],
  }),
  creator: one(users, {
    fields: [supportTickets.createdBy],
    references: [users.id],
    relationName: 'ticketCreator',
  }),
  assignee: one(users, {
    fields: [supportTickets.assignedTo],
    references: [users.id],
    relationName: 'ticketAssignee',
  }),
  messages: many(supportTicketMessages),
}));

export const supportTicketMessagesRelations = relations(supportTicketMessages, ({ one }) => ({
  ticket: one(supportTickets, {
    fields: [supportTicketMessages.ticketId],
    references: [supportTickets.id],
  }),
  author: one(users, {
    fields: [supportTicketMessages.authorId],
    references: [users.id],
  }),
}));
