import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export type Dialect = 'sqlite' | 'pg' | 'mysql';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getDialect(): Dialect {
  const dialect = process.env['DB_DIALECT'] ?? 'sqlite';
  if (dialect !== 'sqlite' && dialect !== 'pg' && dialect !== 'mysql') {
    throw new Error(`Invalid DB_DIALECT: "${dialect}". Must be "sqlite", "pg", or "mysql".`);
  }
  if (dialect === 'sqlite' && process.env['NODE_ENV'] === 'production') {
    console.warn('[WARN] Using SQLite in production is not recommended. Set DB_DIALECT=pg for PostgreSQL.');
  }
  return dialect;
}

export function getConnectionString(): string {
  const dialect = getDialect();

  if (dialect === 'sqlite') {
    if (process.env['DATABASE_PATH']) return process.env['DATABASE_PATH'];
    // Resolve to monorepo root so the path is stable regardless of CWD
    // __dirname = packages/db/src -> 3 levels up = monorepo root
    return resolve(__dirname, '..', '..', '..', 'fleet.db');
  }

  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(`DATABASE_URL environment variable is required for dialect "${dialect}"`);
  }
  return url;
}
