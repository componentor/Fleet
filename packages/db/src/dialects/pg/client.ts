import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import { getConnectionString } from '../../config.js';

const client = postgres(getConnectionString());

export const db = drizzle(client, { schema });

export * from './schema/index.js';
