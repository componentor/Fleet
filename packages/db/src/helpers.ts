import { eq, sql, type SQL } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getDialect } from './config';

// The db instance is set after the dialect is loaded (see index.ts)
let _db: any;

/** @internal Called by index.ts after dialect loading */
export function _setDb(db: any) {
  _db = db;
}

/**
 * Insert a row and return the inserted record.
 * - PG + SQLite: uses native RETURNING clause
 * - MySQL: generates UUID app-side, inserts, then SELECTs back
 */
export async function insertReturning(table: any, values: Record<string, unknown>): Promise<any[]> {
  const dialect = getDialect();

  if (dialect === 'mysql') {
    const id = values['id'] as string ?? crypto.randomUUID();
    const row = { ...values, id };
    await _db.insert(table).values(row);
    return _db.select().from(table).where(eq(table.id, id));
  }

  return _db.insert(table).values(values).returning();
}

/**
 * Update rows and return the updated records.
 * - PG + SQLite: uses native RETURNING clause
 * - MySQL: updates, then SELECTs with the same condition
 */
export async function updateReturning(
  table: any,
  set: Record<string, unknown>,
  condition: SQL,
): Promise<any[]> {
  const dialect = getDialect();

  if (dialect === 'mysql') {
    await _db.update(table).set(set).where(condition);
    return _db.select().from(table).where(condition);
  }

  return _db.update(table).set(set).where(condition).returning();
}

/**
 * Upsert: insert or update on conflict.
 * - PG + SQLite: ON CONFLICT (target) DO UPDATE SET ...
 * - MySQL: ON DUPLICATE KEY UPDATE ...
 */
export async function upsert(
  table: any,
  values: Record<string, unknown>,
  target: any,
  updateSet: Record<string, unknown>,
): Promise<void> {
  const dialect = getDialect();

  if (dialect === 'mysql') {
    await _db.insert(table).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } else {
    await _db.insert(table).values(values).onConflictDoUpdate({ target, set: updateSet });
  }
}

/**
 * Insert and ignore conflicts (idempotent insert).
 * - PG + SQLite: ON CONFLICT DO NOTHING
 * - MySQL: INSERT IGNORE
 */
export async function upsertIgnore(
  table: any,
  values: Record<string, unknown>,
  target?: any,
): Promise<void> {
  const dialect = getDialect();

  if (dialect === 'mysql') {
    // MySQL doesn't have onConflictDoNothing — use onDuplicateKeyUpdate with a no-op
    // Setting the PK to itself is a no-op update that avoids errors
    await _db.insert(table).values(values).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  } else {
    if (target) {
      await _db.insert(table).values(values).onConflictDoNothing({ target });
    } else {
      await _db.insert(table).values(values).onConflictDoNothing();
    }
  }
}

/**
 * Delete rows and return the deleted records.
 * - PG + SQLite: uses native RETURNING clause
 * - MySQL: SELECTs matching rows first, then DELETEs them
 */
export async function deleteReturning(
  table: any,
  condition: SQL,
): Promise<any[]> {
  const dialect = getDialect();

  if (dialect === 'mysql') {
    const rows = await _db.select().from(table).where(condition);
    await _db.delete(table).where(condition);
    return rows;
  }

  return _db.delete(table).where(condition).returning();
}

/**
 * Cross-dialect COUNT(*) that returns a number.
 * - PG: count(*)::int
 * - MySQL: CAST(COUNT(*) AS SIGNED)
 * - SQLite: COUNT(*)
 */
export function countSql(): SQL<number> {
  const dialect = getDialect();

  if (dialect === 'pg') {
    return sql<number>`count(*)::int`;
  }
  if (dialect === 'mysql') {
    return sql<number>`CAST(COUNT(*) AS SIGNED)`;
  }
  return sql<number>`COUNT(*)`;
}
