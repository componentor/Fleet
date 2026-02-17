import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index';
import { getConnectionString } from '../../config';

const pool = mysql.createPool(getConnectionString());

export const db = drizzle(pool, { schema, mode: 'default' });

export * from './schema/index';
