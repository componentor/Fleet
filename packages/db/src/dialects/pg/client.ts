import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';
import { getConnectionString } from '../../config';

const client = postgres(getConnectionString(), {
  max: Number(process.env['PG_POOL_MAX']) || 20,
  idle_timeout: Number(process.env['PG_IDLE_TIMEOUT']) || 30,
  connect_timeout: Number(process.env['PG_CONNECT_TIMEOUT']) || 10,
});

export const db = drizzle(client, { schema });

export * from './schema/index';
