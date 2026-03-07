import { sql as drizzleSql } from 'drizzle-orm';
import { getDialect, getConnectionString } from './config';

/**
 * Run all pending Drizzle migrations programmatically.
 *
 * - PostgreSQL: advisory lock prevents concurrent migrations; each file is transactional
 * - MySQL: GET_LOCK prevents concurrent migrations
 * - SQLite: single-writer by nature, no locking needed
 */
export async function runMigrations(connectionString?: string): Promise<{ applied: number }> {
  const dialect = getDialect();
  const url = connectionString ?? getConnectionString();

  if (dialect === 'pg') {
    return runPgMigrations(url);
  } else if (dialect === 'mysql') {
    return runMysqlMigrations(url);
  } else {
    return runSqliteMigrations(url);
  }
}

async function runPgMigrations(url: string): Promise<{ applied: number }> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  try {
    const LOCK_ID = 738291645;
    await db.execute(drizzleSql`SELECT pg_advisory_lock(${LOCK_ID})`);

    try {
      let beforeCount = 0;
      try {
        const rows = await db.execute(
          drizzleSql`SELECT count(*)::int AS cnt FROM drizzle.__drizzle_migrations`,
        );
        beforeCount = (rows[0] as { cnt: number } | undefined)?.cnt ?? 0;
      } catch {
        beforeCount = 0;
      }

      await migrate(db, {
        migrationsFolder: new URL('./migrations/pg', import.meta.url).pathname,
      });

      let afterCount = 0;
      try {
        const rows = await db.execute(
          drizzleSql`SELECT count(*)::int AS cnt FROM drizzle.__drizzle_migrations`,
        );
        afterCount = (rows[0] as { cnt: number } | undefined)?.cnt ?? 0;
      } catch {
        afterCount = beforeCount;
      }

      return { applied: afterCount - beforeCount };
    } finally {
      await db.execute(drizzleSql`SELECT pg_advisory_unlock(${LOCK_ID})`);
    }
  } finally {
    await client.end();
  }
}

async function runMysqlMigrations(url: string): Promise<{ applied: number }> {
  const mysql = await import('mysql2/promise');
  const { drizzle } = await import('drizzle-orm/mysql2');
  const { migrate } = await import('drizzle-orm/mysql2/migrator');

  const pool = mysql.createPool(url);
  const db = drizzle(pool);

  try {
    // Use MySQL named lock for concurrency safety (5 min timeout for large migrations)
    await db.execute(drizzleSql`SELECT GET_LOCK('fleet_migrate', 300)`);

    try {
      let beforeCount = 0;
      try {
        const rows = await db.execute(
          drizzleSql`SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM drizzle.__drizzle_migrations`,
        );
        beforeCount = (rows as any)[0]?.[0]?.cnt ?? 0;
      } catch {
        beforeCount = 0;
      }

      await migrate(db, {
        migrationsFolder: new URL('./migrations/mysql', import.meta.url).pathname,
      });

      let afterCount = 0;
      try {
        const rows = await db.execute(
          drizzleSql`SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM drizzle.__drizzle_migrations`,
        );
        afterCount = (rows as any)[0]?.[0]?.cnt ?? 0;
      } catch {
        afterCount = beforeCount;
      }

      return { applied: afterCount - beforeCount };
    } finally {
      await db.execute(drizzleSql`SELECT RELEASE_LOCK('fleet_migrate')`);
    }
  } finally {
    await pool.end();
  }
}

async function runSqliteMigrations(path: string): Promise<{ applied: number }> {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { readFileSync } = await import('fs');
  const { createHash } = await import('crypto');

  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);

  const migrationsFolder = new URL('./migrations/sqlite', import.meta.url).pathname;

  try {
    let beforeCount = 0;
    try {
      const rows = db.all(
        drizzleSql`SELECT COUNT(*) AS cnt FROM __drizzle_migrations`,
      ) as any[];
      beforeCount = rows[0]?.cnt ?? 0;
    } catch {
      beforeCount = 0;
    }

    // SQLite doesn't support ADD COLUMN IF NOT EXISTS, so migrations with
    // ALTER TABLE ADD COLUMN can fail with "duplicate column name" if the
    // migration previously partially applied (schema changed but not recorded).
    // Pre-fix: find pending migrations that would fail and mark them as applied.
    fixStuckSqliteMigrations(sqlite, migrationsFolder, readFileSync, createHash);

    migrate(db, { migrationsFolder });

    let afterCount = 0;
    try {
      const rows = db.all(
        drizzleSql`SELECT COUNT(*) AS cnt FROM __drizzle_migrations`,
      ) as any[];
      afterCount = rows[0]?.cnt ?? 0;
    } catch {
      afterCount = beforeCount;
    }

    return { applied: afterCount - beforeCount };
  } finally {
    sqlite.close();
  }
}

/**
 * Pre-fix stuck SQLite migrations where ALTER TABLE ADD COLUMN partially applied
 * (column exists in schema but migration not recorded in __drizzle_migrations).
 */
function fixStuckSqliteMigrations(
  sqlite: import('better-sqlite3').Database,
  migrationsFolder: string,
  readFileSync: typeof import('fs').readFileSync,
  createHash: typeof import('crypto').createHash,
): void {
  // Ensure migrations table exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  // Read journal
  const journalPath = `${migrationsFolder}/meta/_journal.json`;
  let journal: { entries: { idx: number; tag: string; when: number }[] };
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
  } catch {
    return; // No journal = nothing to fix
  }

  // Get the last applied migration's created_at timestamp
  let lastAppliedAt = -1;
  try {
    const row = sqlite.prepare(
      'SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
    ).get() as { created_at: number } | undefined;
    if (row) lastAppliedAt = Number(row.created_at);
  } catch { /* table empty or doesn't exist */ }

  // Get existing columns for all tables (for checking duplicates)
  const existingColumns = new Map<string, Set<string>>();
  const tables = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
  ).all() as { name: string }[];

  for (const { name } of tables) {
    const cols = sqlite.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[];
    existingColumns.set(name, new Set(cols.map(c => c.name)));
  }

  // Check each pending migration
  for (const entry of journal.entries) {
    if (entry.when <= lastAppliedAt) continue; // Already applied

    const sqlPath = `${migrationsFolder}/${entry.tag}.sql`;
    let sqlContent: string;
    try { sqlContent = readFileSync(sqlPath, 'utf-8'); } catch { continue; }

    // Check if this migration has ALTER TABLE ADD COLUMN that would conflict
    const addColRegex = /ALTER\s+TABLE\s+"(\w+)"\s+ADD\s+COLUMN\s+"(\w+)"/gi;
    let hasConflict = false;
    let match: RegExpExecArray | null;

    while ((match = addColRegex.exec(sqlContent)) !== null) {
      const tableName = match[1];
      const colName = match[2];
      if (!tableName || !colName) continue;
      const tableCols = existingColumns.get(tableName);
      if (tableCols?.has(colName)) {
        hasConflict = true;
        break;
      }
    }

    if (!hasConflict) continue;

    // This migration would fail — execute it manually with error handling
    const statements = sqlContent.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      try {
        sqlite.exec(stmt);
      } catch (err: any) {
        if (!err?.message?.includes('duplicate column name')) {
          throw err;
        }
      }
    }

    // Record the migration as applied (same hash algorithm as Drizzle)
    const hash = createHash('sha256').update(sqlContent).digest('hex');
    sqlite.prepare(
      'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
    ).run(hash, entry.when);
  }
}

/**
 * Verify database connectivity and that the schema is usable.
 */
export async function verifyDatabase(connectionString?: string): Promise<{ ok: boolean; error?: string }> {
  const dialect = getDialect();
  const url = connectionString ?? getConnectionString();

  try {
    if (dialect === 'pg') {
      const { default: postgres } = await import('postgres');
      const client = postgres(url, { max: 1, connect_timeout: 5 });
      try {
        const rows = await client`SELECT 1 AS ok`;
        if (rows[0]?.ok === 1) return { ok: true };
        return { ok: false, error: 'Unexpected query result' };
      } finally {
        await client.end();
      }
    } else if (dialect === 'mysql') {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection(url);
      try {
        const [rows] = await conn.execute('SELECT 1 AS ok');
        if ((rows as any)[0]?.ok === 1) return { ok: true };
        return { ok: false, error: 'Unexpected query result' };
      } finally {
        await conn.end();
      }
    } else {
      const { default: Database } = await import('better-sqlite3');
      const sqlite = new Database(url);
      try {
        const row = sqlite.prepare('SELECT 1 AS ok').get() as any;
        if (row?.ok === 1) return { ok: true };
        return { ok: false, error: 'Unexpected query result' };
      } finally {
        sqlite.close();
      }
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
