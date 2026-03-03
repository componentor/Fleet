import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';
import { getConnectionString } from '../../config';

export const rawClient = postgres(getConnectionString(), {
  max: Number(process.env['PG_POOL_MAX']) || 20,
  idle_timeout: Number(process.env['PG_IDLE_TIMEOUT']) || 30,
  connect_timeout: Number(process.env['PG_CONNECT_TIMEOUT']) || 10,
});

export const db = drizzle(rawClient, { schema });

export * from './schema/index';
