import { describe, it, expect, beforeEach } from 'vitest';
import { db, schema, resetDb } from './setup';
import { insertReturning, countSql } from '../helpers';

describe('countSql', () => {
  beforeEach(() => resetDb());

  it('returns a SQL expression', () => {
    const result = countSql();
    expect(result).toBeDefined();
  });

  it('returns correct count for empty table', async () => {
    const [result] = await db
      .select({ count: countSql() })
      .from(schema.accounts);

    expect(result!.count).toBe(0);
  });

  it('returns correct count after inserting rows', async () => {
    await insertReturning(schema.accounts, { name: 'A', slug: 'a' });
    await insertReturning(schema.accounts, { name: 'B', slug: 'b' });
    await insertReturning(schema.accounts, { name: 'C', slug: 'c' });

    const [result] = await db
      .select({ count: countSql() })
      .from(schema.accounts);

    expect(result!.count).toBe(3);
  });
});
