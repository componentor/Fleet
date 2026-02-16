import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const platformSettings = pgTable('platform_settings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  key: varchar('key').unique().notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
