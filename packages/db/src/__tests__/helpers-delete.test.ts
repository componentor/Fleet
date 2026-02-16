import { describe, it, expect, beforeEach } from 'vitest';
import { db, schema, resetDb } from './setup.js';
import { insertReturning, deleteReturning } from '../helpers.js';
import { eq } from 'drizzle-orm';

describe('deleteReturning', () => {
  beforeEach(() => resetDb());

  it('deletes matching rows and returns them', async () => {
    const [row] = await insertReturning(schema.accounts, {
      name: 'Delete Me',
      slug: 'delete-me',
    });

    const deleted = await deleteReturning(
      schema.accounts,
      eq(schema.accounts.id, row.id),
    );

    expect(deleted).toHaveLength(1);
    expect(deleted[0].name).toBe('Delete Me');
  });

  it('returns empty array when no rows match', async () => {
    const result = await deleteReturning(
      schema.accounts,
      eq(schema.accounts.id, 'nonexistent'),
    );

    expect(result).toHaveLength(0);
  });

  it('actually removes the row from the DB', async () => {
    const [row] = await insertReturning(schema.accounts, {
      name: 'Gone',
      slug: 'gone',
    });

    await deleteReturning(schema.accounts, eq(schema.accounts.id, row.id));

    const found = await db.query.accounts.findFirst({
      where: eq(schema.accounts.id, row.id),
    });

    expect(found).toBeUndefined();
  });
});
