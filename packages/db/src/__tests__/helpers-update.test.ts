import { describe, it, expect, beforeEach } from 'vitest';
import { db, schema, resetDb } from './setup';
import { insertReturning, updateReturning } from '../helpers';
import { eq } from 'drizzle-orm';

describe('updateReturning', () => {
  beforeEach(() => resetDb());

  it('updates matching rows and returns them', async () => {
    const [row] = await insertReturning(schema.accounts, {
      name: 'Before',
      slug: 'update-test',
    });

    const [updated] = await updateReturning(
      schema.accounts,
      { name: 'After' },
      eq(schema.accounts.id, row.id),
    );

    expect(updated).toBeDefined();
    expect(updated.name).toBe('After');
    expect(updated.slug).toBe('update-test');
  });

  it('returns empty array when no rows match', async () => {
    const result = await updateReturning(
      schema.accounts,
      { name: 'Nothing' },
      eq(schema.accounts.id, 'nonexistent'),
    );

    expect(result).toHaveLength(0);
  });

  it('only updates rows matching the condition', async () => {
    await insertReturning(schema.accounts, { name: 'Keep', slug: 'keep' });
    const [target] = await insertReturning(schema.accounts, { name: 'Change', slug: 'change' });

    await updateReturning(
      schema.accounts,
      { name: 'Changed' },
      eq(schema.accounts.id, target.id),
    );

    const kept = await db.query.accounts.findFirst({
      where: eq(schema.accounts.slug, 'keep'),
    });

    expect(kept!.name).toBe('Keep');
  });
});
