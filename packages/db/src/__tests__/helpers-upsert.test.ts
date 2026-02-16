import { describe, it, expect, beforeEach } from 'vitest';
import { db, schema, resetDb } from './setup.js';
import { insertReturning, upsert, upsertIgnore } from '../helpers.js';
import { eq } from 'drizzle-orm';

describe('upsert', () => {
  beforeEach(() => resetDb());

  it('inserts when no conflict', async () => {
    await upsert(
      schema.platformSettings,
      { id: 'setting-1', key: 'site_name', value: JSON.stringify('Hoster') },
      schema.platformSettings.key,
      { value: JSON.stringify('Updated') },
    );

    const row = await db.query.platformSettings.findFirst({
      where: eq(schema.platformSettings.key, 'site_name'),
    });

    expect(row).toBeDefined();
    expect(JSON.parse(row!.value as string)).toBe('Hoster');
  });

  it('updates on conflict', async () => {
    await insertReturning(schema.platformSettings, {
      id: 'setting-1',
      key: 'site_name',
      value: JSON.stringify('Old'),
    });

    await upsert(
      schema.platformSettings,
      { id: 'setting-2', key: 'site_name', value: JSON.stringify('Conflict') },
      schema.platformSettings.key,
      { value: JSON.stringify('New') },
    );

    const row = await db.query.platformSettings.findFirst({
      where: eq(schema.platformSettings.key, 'site_name'),
    });

    expect(JSON.parse(row!.value as string)).toBe('New');
  });
});

describe('upsertIgnore', () => {
  beforeEach(() => resetDb());

  it('inserts when no conflict', async () => {
    await upsertIgnore(
      schema.platformSettings,
      { id: 'setting-1', key: 'new_key', value: JSON.stringify('value') },
      schema.platformSettings.key,
    );

    const row = await db.query.platformSettings.findFirst({
      where: eq(schema.platformSettings.key, 'new_key'),
    });

    expect(row).toBeDefined();
  });

  it('silently ignores on conflict', async () => {
    await insertReturning(schema.platformSettings, {
      id: 'setting-1',
      key: 'existing',
      value: JSON.stringify('original'),
    });

    // This should not throw and should not update
    await upsertIgnore(
      schema.platformSettings,
      { id: 'setting-2', key: 'existing', value: JSON.stringify('attempted') },
      schema.platformSettings.key,
    );

    const row = await db.query.platformSettings.findFirst({
      where: eq(schema.platformSettings.key, 'existing'),
    });

    // Original value should be preserved
    expect(row!.id).toBe('setting-1');
  });
});
