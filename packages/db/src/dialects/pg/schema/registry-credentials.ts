import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const registryCredentials = pgTable('registry_credentials', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  registry: varchar('registry').notNull(),
  username: varchar('username').notNull(),
  password: text('password').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
