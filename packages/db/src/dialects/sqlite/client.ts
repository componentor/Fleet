import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema/index.js';
import { getConnectionString } from '../../config.js';
import { SQLITE_DDL } from './ddl.js';

const sqlite = new Database(getConnectionString());
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Auto-create tables if they don't exist (safe for fresh installs)
const hasTable = sqlite.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='users'`,
).get();
if (!hasTable) {
  sqlite.exec(SQLITE_DDL);
}

export const db = drizzle(sqlite, { schema });

export * from './schema/index.js';
