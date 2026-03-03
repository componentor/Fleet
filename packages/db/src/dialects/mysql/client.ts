import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index';
import { getConnectionString } from '../../config';

const pool = mysql.createPool({
  uri: getConnectionString(),
  waitForConnections: true,
  connectionLimit: Number(process.env['MYSQL_POOL_MAX']) || 20,
  idleTimeout: Number(process.env['MYSQL_IDLE_TIMEOUT']) || 30000,
  enableKeepAlive: true,
});

export const db = drizzle(pool, { schema, mode: 'default' });

export const rawClient = pool;

export * from './schema/index';
