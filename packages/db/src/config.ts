export type Dialect = 'sqlite' | 'pg' | 'mysql';

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
    return process.env['DATABASE_PATH'] ?? './fleet.db';
  }

  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(`DATABASE_URL environment variable is required for dialect "${dialect}"`);
  }
  return url;
}
