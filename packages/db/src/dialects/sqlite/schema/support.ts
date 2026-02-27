import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { accounts } from './accounts';

export const supportTickets = sqliteTable('support_tickets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  subject: text('subject').notNull(),
  status: text('status').default('open').notNull(),
  priority: text('priority').default('normal').notNull(),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  createdBy: text('created_by')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  assignedTo: text('assigned_to')
    .references(() => users.id, { onDelete: 'set null' }),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_support_tickets_account_id').on(table.accountId),
  index('idx_support_tickets_status').on(table.status),
  index('idx_support_tickets_assigned_to').on(table.assignedTo),
  index('idx_support_tickets_created_by').on(table.createdBy),
]);

export const supportTicketMessages = sqliteTable('support_ticket_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ticketId: text('ticket_id')
    .references(() => supportTickets.id, { onDelete: 'cascade' })
    .notNull(),
  authorId: text('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  body: text('body').notNull(),
  isInternal: integer('is_internal', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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
