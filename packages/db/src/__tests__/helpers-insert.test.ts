import { describe, it, expect, beforeEach } from 'vitest';
import { db, schema, resetDb } from './setup.js';
import { insertReturning } from '../helpers.js';
import { eq } from 'drizzle-orm';

describe('insertReturning', () => {
  beforeEach(() => resetDb());

  it('inserts a row and returns it', async () => {
    const [row] = await insertReturning(schema.accounts, {
      name: 'Test Account',
      slug: 'test-account',
    });

    expect(row).toBeDefined();
    expect(row.name).toBe('Test Account');
    expect(row.slug).toBe('test-account');
    expect(row.id).toBeDefined();
    expect(typeof row.id).toBe('string');
  });

  it('auto-generates UUID id when not provided', async () => {
    const [row] = await insertReturning(schema.accounts, {
      name: 'No ID',
      slug: 'no-id',
    });

    expect(row.id).toBeDefined();
    expect(row.id.length).toBeGreaterThan(0);
  });

  it('uses provided id when given', async () => {
    const customId = 'custom-id-123';
    const [row] = await insertReturning(schema.accounts, {
      id: customId,
      name: 'Custom ID',
      slug: 'custom-id',
    });

    expect(row.id).toBe(customId);
  });

  it('returns array with exactly one element', async () => {
    const result = await insertReturning(schema.accounts, {
      name: 'Single',
      slug: 'single',
    });

    expect(result).toHaveLength(1);
  });

  it('row persists in the database', async () => {
    const [inserted] = await insertReturning(schema.accounts, {
      name: 'Persist Test',
      slug: 'persist',
    });

    const found = await db.query.accounts.findFirst({
      where: eq(schema.accounts.id, inserted.id),
    });

    expect(found).toBeDefined();
    expect(found!.name).toBe('Persist Test');
  });
});
