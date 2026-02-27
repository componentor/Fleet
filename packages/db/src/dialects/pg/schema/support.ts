import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { accounts } from './accounts';

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  subject: varchar('subject', { length: 255 }).notNull(),
  status: varchar('status').default('open').notNull(),
  priority: varchar('priority').default('normal').notNull(),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  assignedTo: uuid('assigned_to')
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

export const supportTicketMessages = pgTable('support_ticket_messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ticketId: uuid('ticket_id')
    .references(() => supportTickets.id, { onDelete: 'cascade' })
    .notNull(),
  authorId: uuid('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  body: text('body').notNull(),
  senderRole: varchar('sender_role').default('customer').notNull(),
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
