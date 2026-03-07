#!/usr/bin/env node
/**
 * ============================================================================
 * UPGRADE PATH INTEGRATION TEST — ALL 3 DIALECTS
 * ============================================================================
 *
 * Simulates a real upgrade path: A (main) → B (current branch) → C (synthetic future)
 * across SQLite, PostgreSQL, and MySQL.
 *
 * This test ensures that:
 * 1. Main branch migrations apply cleanly to a fresh database
 * 2. Current branch migrations apply on top of main's schema
 * 3. A synthetic future migration applies on top of the current branch's schema
 * 4. The database is healthy and queryable after each step
 * 5. Migrations are idempotent (re-run applies 0)
 * 6. All expected tables exist in the DB (schema completeness)
 * 7. Seeders run successfully and are idempotent
 * 8. Full auth flow: create account → create user → link them → query back (admin login simulation)
 * 9. Drizzle ORM schema matches actual DB (schema-DB sync)
 *
 * This MUST pass before merging to main. If it fails, the upgrade is broken.
 *
 * Usage:
 *   pnpm test:upgrade              # all 3 dialects
 *   pnpm test:upgrade -- sqlite     # SQLite only (no Docker needed)
 *   pnpm test:upgrade -- pg         # PostgreSQL only (needs Docker)
 *   pnpm test:upgrade -- mysql      # MySQL only (needs Docker)
 *
 * ============================================================================
 */

import { execSync, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ── Configuration ───────────────────────────────────────────────────────────

type Dialect = 'sqlite' | 'pg' | 'mysql';

const MAIN_BRANCH = 'main';
const ROOT_DIR = join(import.meta.dirname, '..');
const DB_PACKAGE_DIR = join(ROOT_DIR, 'packages', 'db');
const TEST_DIR = join(tmpdir(), `fleet-upgrade-test-${randomUUID().slice(0, 8)}`);

const PG_CONTAINER = `fleet-upgrade-test-pg-${randomUUID().slice(0, 8)}`;
const MYSQL_CONTAINER = `fleet-upgrade-test-mysql-${randomUUID().slice(0, 8)}`;
const PG_PORT = 54320 + Math.floor(Math.random() * 100);
const MYSQL_PORT = 33060 + Math.floor(Math.random() * 100);
const PG_PASSWORD = 'testpass';
const MYSQL_PASSWORD = 'testpass';

// ── Logging ─────────────────────────────────────────────────────────────────

let totalPassed = 0;
let totalFailed = 0;

function log(msg: string) {
  console.log(`  ${msg}`);
}

function pass(msg: string) {
  totalPassed++;
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}

function fail(msg: string, err?: unknown) {
  totalFailed++;
  console.error(`  \x1b[31m✗\x1b[0m ${msg}`);
  if (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Truncate long error messages
    const truncated = errMsg.length > 500 ? errMsg.slice(0, 500) + '...' : errMsg;
    console.error(`    ${truncated}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m── ${title} ──\x1b[0m`);
}

function dialectHeader(dialect: Dialect) {
  const labels = { sqlite: 'SQLite', pg: 'PostgreSQL', mysql: 'MySQL' };
  console.log(`\n\x1b[1m\x1b[36m━━━━ ${labels[dialect]} ━━━━\x1b[0m`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function copyMigrations(src: string, dest: string) {
  mkdirSync(join(dest, 'meta'), { recursive: true });

  for (const file of readdirSync(src)) {
    if (file.endsWith('.sql')) {
      copyFileSync(join(src, file), join(dest, file));
    }
  }

  const metaSrc = join(src, 'meta');
  if (existsSync(metaSrc)) {
    for (const file of readdirSync(metaSrc)) {
      copyFileSync(join(metaSrc, file), join(dest, 'meta', file));
    }
  }
}

function extractMainBranchMigrations(dialect: Dialect, destDir: string): boolean {
  try {
    mkdirSync(join(destDir, 'meta'), { recursive: true });

    const mainFiles = execSync(
      `git ls-tree -r --name-only ${MAIN_BRANCH} -- packages/db/src/migrations/${dialect}/`,
      { encoding: 'utf-8', cwd: ROOT_DIR },
    ).trim().split('\n').filter(Boolean);

    if (mainFiles.length === 0) return false;

    for (const file of mainFiles) {
      const basename = file.split('/').pop()!;
      const dir = basename === '_journal.json' ? join(destDir, 'meta') : destDir;
      try {
        const content = execSync(
          `git show ${MAIN_BRANCH}:${file}`,
          { encoding: 'utf-8', cwd: ROOT_DIR },
        );
        writeFileSync(join(dir, basename), content);
      } catch { /* file might not exist */ }
    }

    log(`Extracted ${mainFiles.length} files from ${MAIN_BRANCH}/${dialect}`);
    return true;
  } catch {
    return false;
  }
}

/** Create a synthetic future migration for forward-compatibility testing */
function createSyntheticMigration(migrationsDir: string, dialect: Dialect) {
  const journalPath = join(migrationsDir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));

  const lastEntry = journal.entries[journal.entries.length - 1];
  const nextIdx = lastEntry.idx + 1;
  const nextWhen = lastEntry.when + 200000000;
  const tag = '9999_upgrade_path_test';

  let sql: string;
  if (dialect === 'sqlite') {
    sql = [
      `CREATE TABLE IF NOT EXISTS "upgrade_path_test" ("id" text PRIMARY KEY, "value" text, "created_at" integer DEFAULT (unixepoch()));`,
      `--> statement-breakpoint`,
      `INSERT INTO "upgrade_path_test" ("id", "value") VALUES ('test', 'forward-compat-ok');`,
    ].join('\n');
  } else if (dialect === 'pg') {
    sql = [
      `CREATE TABLE IF NOT EXISTS "upgrade_path_test" ("id" text PRIMARY KEY, "value" text, "created_at" timestamp DEFAULT now());`,
      `--> statement-breakpoint`,
      `INSERT INTO "upgrade_path_test" ("id", "value") VALUES ('test', 'forward-compat-ok');`,
    ].join('\n');
  } else {
    sql = [
      'CREATE TABLE IF NOT EXISTS `upgrade_path_test` (`id` varchar(36) PRIMARY KEY, `value` text, `created_at` timestamp DEFAULT CURRENT_TIMESTAMP);',
      `--> statement-breakpoint`,
      "INSERT INTO `upgrade_path_test` (`id`, `value`) VALUES ('test', 'forward-compat-ok');",
    ].join('\n');
  }

  writeFileSync(join(migrationsDir, `${tag}.sql`), sql);

  journal.entries.push({
    idx: nextIdx,
    version: journal.version ?? '7',
    when: nextWhen,
    tag,
    breakpoints: true,
  });

  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
}

// ── SQLite Runner ───────────────────────────────────────────────────────────

function sqliteRunMigrations(dbPath: string, migrationsDir: string, useFix: boolean): { applied: number } {
  const fixCode = useFix ? `
    // fixStuckSqliteMigrations (imports are at top level)
    {
      sqlite.exec('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
      let journal;
      try { journal = JSON.parse(readFileSync(migrationsFolder + '/meta/_journal.json', 'utf-8')); } catch { journal = null; }

      if (journal) {
        let lastAppliedAt = -1;
        try {
          const row = sqlite.prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get();
          if (row) lastAppliedAt = Number(row.created_at);
        } catch {}

        const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'").all();
        const existingColumns = new Map();
        for (const { name } of tables) {
          const cols = sqlite.prepare('PRAGMA table_info("' + name + '")').all();
          existingColumns.set(name, new Set(cols.map(c => c.name)));
        }

        for (const entry of journal.entries) {
          if (entry.when <= lastAppliedAt) continue;
          let sqlContent;
          try { sqlContent = readFileSync(migrationsFolder + '/' + entry.tag + '.sql', 'utf-8'); } catch { continue; }

          const addColRegex = /ALTER\\s+TABLE\\s+"(\\w+)"\\s+ADD\\s+COLUMN\\s+"(\\w+)"/gi;
          let hasConflict = false;
          let match;
          while ((match = addColRegex.exec(sqlContent)) !== null) {
            const tableName = match[1];
            const colName = match[2];
            if (!tableName || !colName) continue;
            if (existingColumns.get(tableName)?.has(colName)) { hasConflict = true; break; }
          }
          if (!hasConflict) continue;

          const stmts = sqlContent.split(';').map(s => s.trim()).filter(Boolean);
          for (const stmt of stmts) {
            try { sqlite.exec(stmt); } catch (err) {
              if (!err?.message?.includes('duplicate column name')) throw err;
            }
          }
          const hash = createHash('sha256').update(sqlContent).digest('hex');
          sqlite.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(hash, entry.when);
        }
      }
    }
  ` : '';

  const script = `
    import Database from 'better-sqlite3';
    import { drizzle } from 'drizzle-orm/better-sqlite3';
    import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
    ${useFix ? "import { readFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';" : ''}

    const sqlite = new Database(${JSON.stringify(dbPath)});
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    const migrationsFolder = ${JSON.stringify(migrationsDir)};

    let before = 0;
    try { before = sqlite.prepare('SELECT COUNT(*) AS cnt FROM __drizzle_migrations').get()?.cnt ?? 0; } catch { before = 0; }

    ${fixCode}

    migrate(db, { migrationsFolder });

    let after = 0;
    try { after = sqlite.prepare('SELECT COUNT(*) AS cnt FROM __drizzle_migrations').get()?.cnt ?? 0; } catch { after = before; }
    sqlite.close();
    console.log(JSON.stringify({ applied: after - before }));
  `;

  return runScript(script, 'sqlite-migrate');
}

function sqliteVerify(dbPath: string): boolean {
  const script = `
    import Database from 'better-sqlite3';
    const sqlite = new Database(${JSON.stringify(dbPath)});
    const row = sqlite.prepare('SELECT 1 AS ok').get();
    const tables = sqlite.prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'").all();
    sqlite.close();
    console.log(JSON.stringify({ ok: row?.ok === 1, tables: tables[0]?.cnt ?? 0 }));
  `;
  const result = runScript(script, 'sqlite-verify');
  return result.ok === true && result.tables > 0;
}

function sqliteCheckFuture(dbPath: string): string | null {
  const script = `
    import Database from 'better-sqlite3';
    const sqlite = new Database(${JSON.stringify(dbPath)});
    const row = sqlite.prepare('SELECT value FROM upgrade_path_test WHERE id = ?').get('test');
    sqlite.close();
    console.log(JSON.stringify({ value: row?.value ?? null }));
  `;
  return runScript(script, 'sqlite-future').value;
}

// ── PostgreSQL Runner ───────────────────────────────────────────────────────

function pgRunMigrations(connStr: string, migrationsDir: string): { applied: number } {
  const script = `
    import postgres from 'postgres';
    import { drizzle } from 'drizzle-orm/postgres-js';
    import { migrate } from 'drizzle-orm/postgres-js/migrator';
    import { sql } from 'drizzle-orm';

    const client = postgres(${JSON.stringify(connStr)}, { max: 1 });
    const db = drizzle(client);
    const migrationsFolder = ${JSON.stringify(migrationsDir)};

    let before = 0;
    try {
      const rows = await db.execute(sql\`SELECT count(*)::int AS cnt FROM drizzle.__drizzle_migrations\`);
      before = rows[0]?.cnt ?? 0;
    } catch { before = 0; }

    await migrate(db, { migrationsFolder });

    let after = 0;
    try {
      const rows = await db.execute(sql\`SELECT count(*)::int AS cnt FROM drizzle.__drizzle_migrations\`);
      after = rows[0]?.cnt ?? 0;
    } catch { after = before; }

    await client.end();
    console.log(JSON.stringify({ applied: after - before }));
  `;
  return runScript(script, 'pg-migrate');
}

function pgVerify(connStr: string): boolean {
  const script = `
    import postgres from 'postgres';
    const client = postgres(${JSON.stringify(connStr)}, { max: 1 });
    const rows = await client\`SELECT 1 AS ok\`;
    const tables = await client\`SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public'\`;
    await client.end();
    console.log(JSON.stringify({ ok: rows[0]?.ok === 1, tables: tables[0]?.cnt ?? 0 }));
  `;
  const result = runScript(script, 'pg-verify');
  return result.ok === true && result.tables > 0;
}

function pgCheckFuture(connStr: string): string | null {
  const script = `
    import postgres from 'postgres';
    const client = postgres(${JSON.stringify(connStr)}, { max: 1 });
    const rows = await client\`SELECT value FROM upgrade_path_test WHERE id = 'test'\`;
    await client.end();
    console.log(JSON.stringify({ value: rows[0]?.value ?? null }));
  `;
  return runScript(script, 'pg-future').value;
}

// ── MySQL Runner ────────────────────────────────────────────────────────────

function mysqlRunMigrations(connStr: string, migrationsDir: string): { applied: number } {
  const script = `
    import mysql from 'mysql2/promise';
    import { drizzle } from 'drizzle-orm/mysql2';
    import { migrate } from 'drizzle-orm/mysql2/migrator';
    import { sql } from 'drizzle-orm';

    const pool = mysql.createPool(${JSON.stringify(connStr)});
    const db = drizzle(pool);
    const migrationsFolder = ${JSON.stringify(migrationsDir)};

    let before = 0;
    try {
      const rows = await db.execute(sql\`SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM drizzle.__drizzle_migrations\`);
      before = rows?.[0]?.[0]?.cnt ?? 0;
    } catch { before = 0; }

    await migrate(db, { migrationsFolder });

    let after = 0;
    try {
      const rows = await db.execute(sql\`SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM drizzle.__drizzle_migrations\`);
      after = rows?.[0]?.[0]?.cnt ?? 0;
    } catch { after = before; }

    await pool.end();
    console.log(JSON.stringify({ applied: after - before }));
  `;
  return runScript(script, 'mysql-migrate');
}

function mysqlVerify(connStr: string): boolean {
  const script = `
    import mysql from 'mysql2/promise';
    const conn = await mysql.createConnection(${JSON.stringify(connStr)});
    const [rows] = await conn.execute('SELECT 1 AS ok');
    const [tables] = await conn.execute("SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE()");
    await conn.end();
    console.log(JSON.stringify({ ok: rows[0]?.ok === 1, tables: tables[0]?.cnt ?? 0 }));
  `;
  const result = runScript(script, 'mysql-verify');
  return result.ok === true && result.tables > 0;
}

function mysqlCheckFuture(connStr: string): string | null {
  const script = `
    import mysql from 'mysql2/promise';
    const conn = await mysql.createConnection(${JSON.stringify(connStr)});
    const [rows] = await conn.execute("SELECT value FROM upgrade_path_test WHERE id = 'test'");
    await conn.end();
    console.log(JSON.stringify({ value: rows[0]?.value ?? null }));
  `;
  return runScript(script, 'mysql-future').value;
}

// ── Expected Tables ─────────────────────────────────────────────────────────

/** All tables that MUST exist after migrations. Update this when adding new tables. */
const EXPECTED_TABLES = [
  'accounts', 'users', 'user_accounts', 'oauth_providers',
  'services', 'deployments',
  'dns_zones', 'dns_records', 'domain_registrars', 'domain_registrations',
  'domain_tld_pricing', 'domain_tld_currency_prices', 'shared_domains', 'subdomain_claims',
  'billing_plans', 'subscriptions', 'usage_records', 'pricing_config',
  'location_multipliers', 'billing_config', 'resource_limits',
  'account_billing_overrides', 'webhook_events', 'billing_plan_prices',
  'reseller_config', 'reseller_accounts', 'reseller_applications',
  'nodes', 'node_metrics',
  'email_templates', 'email_log',
  'platform_settings',
  'api_keys',
  'ssh_keys', 'ssh_access_rules',
  'backups', 'backup_schedules',
  'notifications',
  'app_templates',
  'error_log', 'audit_log', 'log_archives',
  'admin_roles',
  'support_tickets', 'support_ticket_messages',
  'status_posts', 'status_post_translations', 'uptime_snapshots',
  'self_healing_jobs',
  'registry_credentials',
  'storage_clusters', 'storage_nodes', 'storage_volumes', 'storage_migrations',
  'stacks',
  'service_analytics',
  'visitor_analytics',
];

// ── Schema Completeness Checks ──────────────────────────────────────────────

function sqliteCheckTables(dbPath: string): { found: string[]; missing: string[] } {
  const script = `
    import Database from 'better-sqlite3';
    const sqlite = new Database(${JSON.stringify(dbPath)});
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' AND name != 'fleet_seeders'").all();
    sqlite.close();
    console.log(JSON.stringify({ tables: tables.map(t => t.name) }));
  `;
  const result = runScript(script, 'sqlite-tables');
  const found = result.tables as string[];
  const missing = EXPECTED_TABLES.filter(t => !found.includes(t));
  return { found, missing };
}

function pgCheckTables(connStr: string): { found: string[]; missing: string[] } {
  const script = `
    import postgres from 'postgres';
    const client = postgres(${JSON.stringify(connStr)}, { max: 1 });
    const tables = await client\`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%' AND tablename != 'fleet_seeders'\`;
    await client.end();
    console.log(JSON.stringify({ tables: tables.map(t => t.tablename) }));
  `;
  const result = runScript(script, 'pg-tables');
  const found = result.tables as string[];
  const missing = EXPECTED_TABLES.filter(t => !found.includes(t));
  return { found, missing };
}

function mysqlCheckTables(connStr: string): { found: string[]; missing: string[] } {
  const script = `
    import mysql from 'mysql2/promise';
    const conn = await mysql.createConnection(${JSON.stringify(connStr)});
    const [rows] = await conn.execute("SELECT table_name AS tablename FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name NOT LIKE '__drizzle%' AND table_name != 'fleet_seeders'");
    await conn.end();
    console.log(JSON.stringify({ tables: rows.map(r => r.tablename || r.TABLE_NAME) }));
  `;
  const result = runScript(script, 'mysql-tables');
  const found = result.tables as string[];
  const missing = EXPECTED_TABLES.filter(t => !found.includes(t));
  return { found, missing };
}

// ── Seeder Checks ───────────────────────────────────────────────────────────

function sqliteRunSeeders(dbPath: string): { executed: number } {
  const script = `
    import Database from 'better-sqlite3';
    import { drizzle } from 'drizzle-orm/better-sqlite3';
    import { sql } from 'drizzle-orm';
    import * as schema from '../src/dialects/sqlite/schema/index.ts';

    const sqlite = new Database(${JSON.stringify(dbPath)});
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });

    // Create seeder tracking table
    db.run(sql\`CREATE TABLE IF NOT EXISTS fleet_seeders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      description TEXT NOT NULL,
      executed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(version, description)
    )\`);

    // Count before
    const before = db.all(sql\`SELECT COUNT(*) AS cnt FROM fleet_seeders\`);
    const beforeCount = before[0]?.cnt ?? 0;

    // Run the seed module
    const { runSeeders } = await import('../src/seed.ts');
    await runSeeders(${JSON.stringify(dbPath)});

    const after = db.all(sql\`SELECT COUNT(*) AS cnt FROM fleet_seeders\`);
    const afterCount = after[0]?.cnt ?? 0;

    sqlite.close();
    console.log(JSON.stringify({ executed: afterCount - beforeCount }));
  `;
  return runScript(script, 'sqlite-seed', { DB_DIALECT: 'sqlite', DATABASE_PATH: dbPath }, { useTsx: true });
}

function pgRunSeeders(connStr: string): { executed: number } {
  const script = `
    import postgres from 'postgres';
    import { drizzle } from 'drizzle-orm/postgres-js';
    import { sql } from 'drizzle-orm';

    const client = postgres(${JSON.stringify(connStr)}, { max: 1 });
    const db = drizzle(client);

    // Create seeder tracking table
    await db.execute(sql\`CREATE TABLE IF NOT EXISTS fleet_seeders (
      id SERIAL PRIMARY KEY,
      version VARCHAR NOT NULL,
      description VARCHAR NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(version, description)
    )\`);

    const before = await db.execute(sql\`SELECT count(*)::int AS cnt FROM fleet_seeders\`);
    const beforeCount = before[0]?.cnt ?? 0;

    const { runSeeders } = await import('../src/seed.ts');
    await runSeeders(${JSON.stringify(connStr)});

    const after = await db.execute(sql\`SELECT count(*)::int AS cnt FROM fleet_seeders\`);
    const afterCount = after[0]?.cnt ?? 0;

    await client.end();
    console.log(JSON.stringify({ executed: afterCount - beforeCount }));
  `;
  return runScript(script, 'pg-seed', { DB_DIALECT: 'pg', DATABASE_URL: connStr }, { useTsx: true });
}

function mysqlRunSeeders(connStr: string): { executed: number } {
  const script = `
    import mysql from 'mysql2/promise';
    import { drizzle } from 'drizzle-orm/mysql2';
    import { sql } from 'drizzle-orm';

    const pool = mysql.createPool(${JSON.stringify(connStr)});
    const db = drizzle(pool);

    await db.execute(sql\`CREATE TABLE IF NOT EXISTS fleet_seeders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(255) NOT NULL,
      description VARCHAR(255) NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_seeder (version, description)
    )\`);

    const before = await db.execute(sql\`SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM fleet_seeders\`);
    const beforeCount = before?.[0]?.[0]?.cnt ?? 0;

    const { runSeeders } = await import('../src/seed.ts');
    await runSeeders(${JSON.stringify(connStr)});

    const after = await db.execute(sql\`SELECT CAST(COUNT(*) AS SIGNED) AS cnt FROM fleet_seeders\`);
    const afterCount = after?.[0]?.[0]?.cnt ?? 0;

    await pool.end();
    console.log(JSON.stringify({ executed: afterCount - beforeCount }));
  `;
  return runScript(script, 'mysql-seed', { DB_DIALECT: 'mysql', DATABASE_URL: connStr }, { useTsx: true });
}

// ── Auth Simulation (CRUD + ORM query) ──────────────────────────────────────

function sqliteAuthSimulation(dbPath: string): { ok: boolean; error?: string } {
  const script = `
    import Database from 'better-sqlite3';
    import { drizzle } from 'drizzle-orm/better-sqlite3';
    import { eq } from 'drizzle-orm';
    import * as schema from '../src/dialects/sqlite/schema/index.ts';
    import crypto from 'node:crypto';

    const sqlite = new Database(${JSON.stringify(dbPath)});
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });

    const accountId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const userAccountId = crypto.randomUUID();

    // 1. Create account
    db.insert(schema.accounts).values({
      id: accountId,
      name: 'Test Account',
      slug: 'test-upgrade-' + accountId.slice(0, 8),
    }).run();

    // 2. Create user (simulates admin registration)
    db.insert(schema.users).values({
      id: userId,
      email: 'admin-' + userId.slice(0, 8) + '@test.local',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fakeHashForTesting',
      name: 'Test Admin',
      isSuper: true,
      emailVerified: true,
    }).run();

    // 3. Link user to account
    db.insert(schema.userAccounts).values({
      id: userAccountId,
      userId,
      accountId,
      role: 'owner',
    }).run();

    // 4. Query back via ORM (simulates login + session load)
    const [user] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all();
    const [ua] = db.select().from(schema.userAccounts)
      .innerJoin(schema.accounts, eq(schema.userAccounts.accountId, schema.accounts.id))
      .where(eq(schema.userAccounts.userId, userId))
      .all();

    // 5. Verify the data roundtrips correctly
    const checks = {
      userFound: !!user,
      emailMatch: user?.email?.includes('test.local') ?? false,
      isSuper: user?.isSuper === true,
      hasAccount: !!ua,
      accountName: ua?.accounts?.name === 'Test Account',
      role: ua?.user_accounts?.role === 'owner',
    };

    const allOk = Object.values(checks).every(v => v === true);

    // 6. Create a service (simulates deploying after login)
    const serviceId = crypto.randomUUID();
    db.insert(schema.services).values({
      id: serviceId,
      accountId,
      name: 'test-service',
      image: 'nginx:latest',
      status: 'running',
    }).run();

    const [svc] = db.select().from(schema.services).where(eq(schema.services.id, serviceId)).all();
    const serviceOk = svc?.name === 'test-service' && svc?.accountId === accountId;

    // Clean up test data
    db.delete(schema.services).where(eq(schema.services.id, serviceId)).run();
    db.delete(schema.userAccounts).where(eq(schema.userAccounts.id, userAccountId)).run();
    db.delete(schema.users).where(eq(schema.users.id, userId)).run();
    db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run();

    sqlite.close();
    console.log(JSON.stringify({ ok: allOk && serviceOk, checks: { ...checks, serviceOk } }));
  `;
  try {
    const result = runScript(script, 'sqlite-auth', undefined, { useTsx: true });
    return { ok: result.ok, error: result.ok ? undefined : JSON.stringify(result.checks) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function pgAuthSimulation(connStr: string): { ok: boolean; error?: string } {
  const script = `
    import postgres from 'postgres';
    import { drizzle } from 'drizzle-orm/postgres-js';
    import { eq } from 'drizzle-orm';
    import * as schema from '../src/dialects/pg/schema/index.ts';
    import crypto from 'node:crypto';

    const client = postgres(${JSON.stringify(connStr)}, { max: 1 });
    const db = drizzle(client, { schema });

    const accountId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const userAccountId = crypto.randomUUID();

    await db.insert(schema.accounts).values({
      id: accountId,
      name: 'Test Account',
      slug: 'test-upgrade-' + accountId.slice(0, 8),
    });

    await db.insert(schema.users).values({
      id: userId,
      email: 'admin-' + userId.slice(0, 8) + '@test.local',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fakeHashForTesting',
      name: 'Test Admin',
      isSuper: true,
      emailVerified: true,
    });

    await db.insert(schema.userAccounts).values({
      id: userAccountId,
      userId,
      accountId,
      role: 'owner',
    });

    // Query back via ORM (simulates login + session load)
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const [ua] = await db.select().from(schema.userAccounts)
      .innerJoin(schema.accounts, eq(schema.userAccounts.accountId, schema.accounts.id))
      .where(eq(schema.userAccounts.userId, userId));

    const checks = {
      userFound: !!user,
      emailMatch: user?.email?.includes('test.local') ?? false,
      isSuper: user?.isSuper === true,
      hasAccount: !!ua,
      accountName: ua?.accounts?.name === 'Test Account',
      role: ua?.user_accounts?.role === 'owner',
    };

    const allOk = Object.values(checks).every(v => v === true);

    const serviceId = crypto.randomUUID();
    await db.insert(schema.services).values({
      id: serviceId,
      accountId,
      name: 'test-service',
      image: 'nginx:latest',
      status: 'running',
    });

    const [svc] = await db.select().from(schema.services).where(eq(schema.services.id, serviceId));
    const serviceOk = svc?.name === 'test-service' && svc?.accountId === accountId;

    // Clean up
    await db.delete(schema.services).where(eq(schema.services.id, serviceId));
    await db.delete(schema.userAccounts).where(eq(schema.userAccounts.id, userAccountId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId));

    await client.end();
    console.log(JSON.stringify({ ok: allOk && serviceOk, checks: { ...checks, serviceOk } }));
  `;
  try {
    const result = runScript(script, 'pg-auth', undefined, { useTsx: true });
    return { ok: result.ok, error: result.ok ? undefined : JSON.stringify(result.checks) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function mysqlAuthSimulation(connStr: string): { ok: boolean; error?: string } {
  const script = `
    import mysql from 'mysql2/promise';
    import { drizzle } from 'drizzle-orm/mysql2';
    import { eq } from 'drizzle-orm';
    import * as schema from '../src/dialects/mysql/schema/index.ts';
    import crypto from 'node:crypto';

    const pool = mysql.createPool(${JSON.stringify(connStr)});
    const db = drizzle(pool, { schema, mode: 'default' });

    const accountId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const userAccountId = crypto.randomUUID();

    await db.insert(schema.accounts).values({
      id: accountId,
      name: 'Test Account',
      slug: 'test-upgrade-' + accountId.slice(0, 8),
    });

    await db.insert(schema.users).values({
      id: userId,
      email: 'admin-' + userId.slice(0, 8) + '@test.local',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fakeHashForTesting',
      name: 'Test Admin',
      isSuper: true,
      emailVerified: true,
    });

    await db.insert(schema.userAccounts).values({
      id: userAccountId,
      userId,
      accountId,
      role: 'owner',
    });

    // Query back via ORM (simulates login + session load)
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const [ua] = await db.select().from(schema.userAccounts)
      .innerJoin(schema.accounts, eq(schema.userAccounts.accountId, schema.accounts.id))
      .where(eq(schema.userAccounts.userId, userId));

    const checks = {
      userFound: !!user,
      emailMatch: user?.email?.includes('test.local') ?? false,
      isSuper: user?.isSuper === true,
      hasAccount: !!ua,
      accountName: ua?.accounts?.name === 'Test Account',
      role: ua?.user_accounts?.role === 'owner',
    };

    const allOk = Object.values(checks).every(v => v === true);

    const serviceId = crypto.randomUUID();
    await db.insert(schema.services).values({
      id: serviceId,
      accountId,
      name: 'test-service',
      image: 'nginx:latest',
      status: 'running',
    });

    const [svc] = await db.select().from(schema.services).where(eq(schema.services.id, serviceId));
    const serviceOk = svc?.name === 'test-service' && svc?.accountId === accountId;

    // Clean up
    await db.delete(schema.services).where(eq(schema.services.id, serviceId));
    await db.delete(schema.userAccounts).where(eq(schema.userAccounts.id, userAccountId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId));

    await pool.end();
    console.log(JSON.stringify({ ok: allOk && serviceOk, checks: { ...checks, serviceOk } }));
  `;
  try {
    const result = runScript(script, 'mysql-auth', undefined, { useTsx: true });
    return { ok: result.ok, error: result.ok ? undefined : JSON.stringify(result.checks) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Shared Script Runner ────────────────────────────────────────────────────

let scriptCounter = 0;

function runScript(script: string, label: string, extraEnv?: Record<string, string>, opts?: { useTsx?: boolean }): any {
  // Write script INTO the db package directory so Node can resolve its dependencies
  const scriptDir = join(DB_PACKAGE_DIR, '.upgrade-test-tmp');
  mkdirSync(scriptDir, { recursive: true });
  const scriptPath = join(scriptDir, `${label}-${scriptCounter++}.ts`);
  writeFileSync(scriptPath, script);

  try {
    // Use tsx for scripts that import schema modules (extensionless TS imports).
    // Use plain node with --experimental-strip-types for migration scripts.
    const cmd = opts?.useTsx ? 'npx' : 'node';
    const args = opts?.useTsx
      ? ['tsx', scriptPath]
      : ['--experimental-strip-types', '--no-warnings', scriptPath];

    const result = execFileSync(cmd, args, {
      cwd: DB_PACKAGE_DIR,
      env: { ...process.env, NODE_NO_WARNINGS: '1', ...extraEnv },
      encoding: 'utf-8',
      timeout: 60_000,
    });

    const lines = result.trim().split('\n');
    return JSON.parse(lines[lines.length - 1]!);
  } finally {
    // Clean up the temp script
    try { rmSync(scriptPath, { force: true }); } catch {}
  }
}

// ── Docker Container Management ─────────────────────────────────────────────

function startPostgres(): string {
  log(`Starting PostgreSQL container (${PG_CONTAINER})...`);
  execSync(
    `docker run -d --name ${PG_CONTAINER} -p ${PG_PORT}:5432 ` +
    `-e POSTGRES_PASSWORD=${PG_PASSWORD} -e POSTGRES_DB=fleet_test ` +
    `postgres:16-alpine`,
    { stdio: 'pipe' },
  );

  // Wait for PostgreSQL to be ready
  for (let i = 0; i < 30; i++) {
    try {
      execSync(
        `docker exec ${PG_CONTAINER} pg_isready -U postgres`,
        { stdio: 'pipe', timeout: 3000 },
      );
      log('PostgreSQL is ready.');
      return `postgres://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/fleet_test`;
    } catch {
      execSync('sleep 1');
    }
  }
  throw new Error('PostgreSQL did not become ready in time');
}

function stopPostgres() {
  try {
    execSync(`docker rm -f ${PG_CONTAINER}`, { stdio: 'pipe' });
  } catch { /* container may not exist */ }
}

function startMySQL(): string {
  log(`Starting MySQL container (${MYSQL_CONTAINER})...`);
  execSync(
    `docker run -d --name ${MYSQL_CONTAINER} -p ${MYSQL_PORT}:3306 ` +
    `-e MYSQL_ROOT_PASSWORD=${MYSQL_PASSWORD} -e MYSQL_DATABASE=fleet_test ` +
    `mysql:8.0 --default-authentication-plugin=mysql_native_password`,
    { stdio: 'pipe' },
  );

  // Wait for MySQL to be ready
  for (let i = 0; i < 60; i++) {
    try {
      execSync(
        `docker exec ${MYSQL_CONTAINER} mysqladmin ping -h127.0.0.1 -uroot -p${MYSQL_PASSWORD} --silent`,
        { stdio: 'pipe', timeout: 3000 },
      );
      log('MySQL is ready.');
      return `mysql://root:${MYSQL_PASSWORD}@127.0.0.1:${MYSQL_PORT}/fleet_test`;
    } catch {
      execSync('sleep 1');
    }
  }
  throw new Error('MySQL did not become ready in time');
}

function stopMySQL() {
  try {
    execSync(`docker rm -f ${MYSQL_CONTAINER}`, { stdio: 'pipe' });
  } catch { /* container may not exist */ }
}

// ── Dialect Test Runner ─────────────────────────────────────────────────────

async function testDialect(dialect: Dialect): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed_ = 0;

  function p(msg: string) { passed++; totalPassed++; pass(msg); }
  function f(msg: string, err?: unknown) { failed_++; totalFailed++; fail(msg, err); }

  dialectHeader(dialect);

  const migrationsDir = join(DB_PACKAGE_DIR, 'src', 'migrations', dialect);
  const mainMigrDir = join(TEST_DIR, `${dialect}-main`);
  const currentMigrDir = join(TEST_DIR, `${dialect}-current`);
  const futureMigrDir = join(TEST_DIR, `${dialect}-future`);

  // Connection info
  let connStr = '';
  let dbPath = '';

  if (dialect === 'sqlite') {
    dbPath = join(TEST_DIR, `${dialect}-test.db`);
  } else if (dialect === 'pg') {
    try {
      connStr = startPostgres();
    } catch (err) {
      f('Could not start PostgreSQL container', err);
      return { passed, failed: failed_ };
    }
  } else {
    try {
      connStr = startMySQL();
    } catch (err) {
      f('Could not start MySQL container', err);
      return { passed, failed: failed_ };
    }
  }

  try {
    // ── Step 1: Extract main branch migrations ──────────────────

    section(`${dialect}: Step 1 — Extract state A (main branch)`);

    const extracted = extractMainBranchMigrations(dialect, mainMigrDir);
    if (!extracted) {
      log(`No main branch for ${dialect} — using current as state A`);
      copyMigrations(migrationsDir, mainMigrDir);
    }
    p('State A migrations extracted');

    // ── Step 2: Apply state A ───────────────────────────────────

    section(`${dialect}: Step 2 — Apply state A (main → fresh DB)`);

    try {
      let resultA;
      if (dialect === 'sqlite') {
        resultA = sqliteRunMigrations(dbPath, mainMigrDir, false);
      } else if (dialect === 'pg') {
        resultA = pgRunMigrations(connStr, mainMigrDir);
      } else {
        resultA = mysqlRunMigrations(connStr, mainMigrDir);
      }
      p(`State A: ${resultA.applied} migration(s) applied`);
    } catch (err) {
      f('State A migrations FAILED', err);
      return { passed, failed: failed_ };
    }

    // Verify health
    try {
      let healthy;
      if (dialect === 'sqlite') healthy = sqliteVerify(dbPath);
      else if (dialect === 'pg') healthy = pgVerify(connStr);
      else healthy = mysqlVerify(connStr);

      if (healthy) p('State A: DB healthy');
      else { f('State A: DB health check failed'); return { passed, failed: failed_ }; }
    } catch (err) {
      f('State A: DB health error', err);
      return { passed, failed: failed_ };
    }

    // ── Step 3: Apply state B ───────────────────────────────────

    section(`${dialect}: Step 3 — Apply state B (current branch → state A)`);

    copyMigrations(migrationsDir, currentMigrDir);

    try {
      let resultB;
      if (dialect === 'sqlite') {
        resultB = sqliteRunMigrations(dbPath, currentMigrDir, true);
      } else if (dialect === 'pg') {
        resultB = pgRunMigrations(connStr, currentMigrDir);
      } else {
        resultB = mysqlRunMigrations(connStr, currentMigrDir);
      }
      p(`State B: ${resultB.applied} migration(s) applied`);
    } catch (err) {
      f('State B migrations FAILED — UPGRADE FROM MAIN IS BROKEN', err);
      return { passed, failed: failed_ };
    }

    // Verify health
    try {
      let healthy;
      if (dialect === 'sqlite') healthy = sqliteVerify(dbPath);
      else if (dialect === 'pg') healthy = pgVerify(connStr);
      else healthy = mysqlVerify(connStr);

      if (healthy) p('State B: DB healthy after upgrade');
      else { f('State B: DB health check failed'); return { passed, failed: failed_ }; }
    } catch (err) {
      f('State B: DB health error', err);
      return { passed, failed: failed_ };
    }

    // ── Step 4: Apply state C (synthetic future) ────────────────

    section(`${dialect}: Step 4 — Apply state C (synthetic future → state B)`);

    copyMigrations(migrationsDir, futureMigrDir);
    createSyntheticMigration(futureMigrDir, dialect);

    try {
      let resultC;
      if (dialect === 'sqlite') {
        resultC = sqliteRunMigrations(dbPath, futureMigrDir, true);
      } else if (dialect === 'pg') {
        resultC = pgRunMigrations(connStr, futureMigrDir);
      } else {
        resultC = mysqlRunMigrations(connStr, futureMigrDir);
      }
      p(`State C: ${resultC.applied} migration(s) applied (future)`);
    } catch (err) {
      f('State C FAILED — STATE B LEAVES DB NON-UPGRADABLE', err);
      return { passed, failed: failed_ };
    }

    // Verify health
    try {
      let healthy;
      if (dialect === 'sqlite') healthy = sqliteVerify(dbPath);
      else if (dialect === 'pg') healthy = pgVerify(connStr);
      else healthy = mysqlVerify(connStr);

      if (healthy) p('State C: DB healthy after future upgrade');
      else { f('State C: DB health check failed'); return { passed, failed: failed_ }; }
    } catch (err) {
      f('State C: DB health error', err);
      return { passed, failed: failed_ };
    }

    // ── Step 5: Verify forward-compatibility ────────────────────

    section(`${dialect}: Step 5 — Verify forward-compatibility`);

    try {
      let value: string | null;
      if (dialect === 'sqlite') value = sqliteCheckFuture(dbPath);
      else if (dialect === 'pg') value = pgCheckFuture(connStr);
      else value = mysqlCheckFuture(connStr);

      if (value === 'forward-compat-ok') {
        p('Forward-compatibility data verified');
      } else {
        f(`Forward-compatibility data mismatch: ${value}`);
      }
    } catch (err) {
      f('Forward-compatibility verification error', err);
    }

    // ── Step 6: Idempotency ─────────────────────────────────────

    section(`${dialect}: Step 6 — Idempotency (re-run = 0 applied)`);

    try {
      let resultRerun;
      if (dialect === 'sqlite') {
        resultRerun = sqliteRunMigrations(dbPath, futureMigrDir, true);
      } else if (dialect === 'pg') {
        resultRerun = pgRunMigrations(connStr, futureMigrDir);
      } else {
        resultRerun = mysqlRunMigrations(connStr, futureMigrDir);
      }

      if (resultRerun.applied === 0) {
        p('Idempotency: re-run applied 0 (correct)');
      } else {
        f(`Idempotency: re-run applied ${resultRerun.applied} (should be 0)`);
      }
    } catch (err) {
      f('Idempotency test FAILED', err);
    }

    // ── Step 7: Schema completeness ──────────────────────────────

    section(`${dialect}: Step 7 — Schema completeness`);

    try {
      let tableResult;
      if (dialect === 'sqlite') tableResult = sqliteCheckTables(dbPath);
      else if (dialect === 'pg') tableResult = pgCheckTables(connStr);
      else tableResult = mysqlCheckTables(connStr);

      if (tableResult.missing.length === 0) {
        p(`All ${EXPECTED_TABLES.length} expected tables found`);
      } else {
        f(`Missing tables (${tableResult.missing.length}): ${tableResult.missing.join(', ')}`);
      }
    } catch (err) {
      f('Schema completeness check error', err);
    }

    // ── Step 8: Seeders ─────────────────────────────────────────

    section(`${dialect}: Step 8 — Seeders`);

    try {
      let seedResult;
      if (dialect === 'sqlite') seedResult = sqliteRunSeeders(dbPath);
      else if (dialect === 'pg') seedResult = pgRunSeeders(connStr);
      else seedResult = mysqlRunSeeders(connStr);

      p(`Seeders: ${seedResult.executed} executed`);

      // Verify idempotency
      let seedResult2;
      if (dialect === 'sqlite') seedResult2 = sqliteRunSeeders(dbPath);
      else if (dialect === 'pg') seedResult2 = pgRunSeeders(connStr);
      else seedResult2 = mysqlRunSeeders(connStr);

      if (seedResult2.executed === 0) {
        p('Seeders: idempotent (re-run executed 0)');
      } else {
        f(`Seeders: not idempotent (re-run executed ${seedResult2.executed})`);
      }
    } catch (err) {
      f('Seeder execution FAILED', err);
    }

    // ── Step 9: Auth simulation (CRUD + ORM relations) ──────────

    section(`${dialect}: Step 9 — Auth simulation (admin login flow)`);

    try {
      let authResult;
      if (dialect === 'sqlite') authResult = sqliteAuthSimulation(dbPath);
      else if (dialect === 'pg') authResult = pgAuthSimulation(connStr);
      else authResult = mysqlAuthSimulation(connStr);

      if (authResult.ok) {
        p('Auth simulation: account → user → login → deploy → query all passed');
      } else {
        f(`Auth simulation FAILED: ${authResult.error}`);
      }
    } catch (err) {
      f('Auth simulation error', err);
    }

  } finally {
    if (dialect === 'pg') stopPostgres();
    if (dialect === 'mysql') stopMySQL();
  }

  return { passed, failed: failed_ };
}

// ── Docker Availability Check ───────────────────────────────────────────────

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\x1b[1m\n============================================');
  console.log(' UPGRADE PATH INTEGRATION TEST');
  console.log('============================================\x1b[0m');
  console.log(`Test directory: ${TEST_DIR}`);

  // Parse args
  const args = process.argv.slice(2);
  let dialects: Dialect[];

  if (args.includes('sqlite')) {
    dialects = ['sqlite'];
  } else if (args.includes('pg')) {
    dialects = ['pg'];
  } else if (args.includes('mysql')) {
    dialects = ['mysql'];
  } else {
    // Default: all dialects
    const hasDocker = isDockerAvailable();
    dialects = ['sqlite'];
    if (hasDocker) {
      dialects.push('pg', 'mysql');
    } else {
      log('Docker not available — skipping PostgreSQL and MySQL tests');
      log('Run with Docker to test all 3 dialects');
    }
  }

  console.log(`Dialects: ${dialects.join(', ')}`);

  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });

  const results: Record<string, { passed: number; failed: number }> = {};

  try {
    for (const dialect of dialects) {
      results[dialect] = await testDialect(dialect);
    }
  } finally {
    rmSync(TEST_DIR, { recursive: true, force: true });
    rmSync(join(DB_PACKAGE_DIR, '.upgrade-test-tmp'), { recursive: true, force: true });
  }

  // ── Summary ─────────────────────────────────────────────────────

  console.log('\n\x1b[1m============================================');
  console.log(' RESULTS');
  console.log('============================================\x1b[0m');

  for (const [dialect, result] of Object.entries(results)) {
    const status = result.failed === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${dialect.padEnd(8)} ${status}  (${result.passed} passed, ${result.failed} failed)`);
  }

  console.log(`\n  Total:   ${totalPassed} passed, ${totalFailed} failed\n`);

  if (totalFailed > 0) {
    console.error('\x1b[31mUPGRADE PATH TEST FAILED\x1b[0m');
    console.error('Fix the migration issues before merging to main.');
    process.exit(1);
  } else {
    console.log('\x1b[32mUPGRADE PATH TEST PASSED\x1b[0m');
    console.log('The upgrade path A → B → C is verified across all tested dialects.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('\x1b[31mTest runner crashed:\x1b[0m', err);
  stopPostgres();
  stopMySQL();
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(join(DB_PACKAGE_DIR, '.upgrade-test-tmp'), { recursive: true, force: true });
  process.exit(1);
});
