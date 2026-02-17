import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';
import { getConnectionString } from '../../config';

const client = postgres(getConnectionString());

export const db = drizzle(client, { schema });

export * from './schema/index';
