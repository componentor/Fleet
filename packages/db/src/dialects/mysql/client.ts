import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index.js';
import { getConnectionString } from '../../config.js';

const pool = mysql.createPool(getConnectionString());

export const db = drizzle(pool, { schema, mode: 'default' });

export * from './schema/index.js';
