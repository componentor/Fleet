import { defineConfig } from 'drizzle-kit';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dialect = process.env['DB_DIALECT'] ?? 'sqlite';

function getConfig() {
  if (dialect === 'mysql') {
    return defineConfig({
      dialect: 'mysql',
      schema: './src/dialects/mysql/schema',
      out: './src/migrations/mysql',
      dbCredentials: {
        url: process.env['DATABASE_URL']!,
      },
    });
  }

  if (dialect === 'pg') {
    return defineConfig({
      dialect: 'postgresql',
      schema: './src/dialects/pg/schema',
      out: './src/migrations/pg',
      dbCredentials: {
        url: process.env['DATABASE_URL']!,
      },
    });
  }

  // Default: sqlite
  return defineConfig({
    dialect: 'sqlite',
    schema: './src/dialects/sqlite/schema',
    out: './src/migrations/sqlite',
    dbCredentials: {
      url: process.env['DATABASE_PATH'] ?? resolve(__dirname, '..', '..', 'fleet.db'),
    },
  });
}

export default getConfig();
