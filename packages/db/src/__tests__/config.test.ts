import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDialect, getConnectionString } from '../config.js';

describe('getDialect', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns sqlite when DB_DIALECT is unset', () => {
    delete process.env['DB_DIALECT'];
    expect(getDialect()).toBe('sqlite');
  });

  it('returns pg for DB_DIALECT=pg', () => {
    process.env['DB_DIALECT'] = 'pg';
    expect(getDialect()).toBe('pg');
  });

  it('returns mysql for DB_DIALECT=mysql', () => {
    process.env['DB_DIALECT'] = 'mysql';
    expect(getDialect()).toBe('mysql');
  });

  it('throws on invalid dialect', () => {
    process.env['DB_DIALECT'] = 'oracle';
    expect(() => getDialect()).toThrow('Invalid DB_DIALECT');
  });
});

describe('getConnectionString', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns DATABASE_PATH for sqlite', () => {
    delete process.env['DB_DIALECT'];
    process.env['DATABASE_PATH'] = '/tmp/test.db';
    expect(getConnectionString()).toBe('/tmp/test.db');
  });

  it('returns default ./hoster.db when DATABASE_PATH not set', () => {
    delete process.env['DB_DIALECT'];
    delete process.env['DATABASE_PATH'];
    expect(getConnectionString()).toBe('./hoster.db');
  });

  it('returns DATABASE_URL for pg', () => {
    process.env['DB_DIALECT'] = 'pg';
    process.env['DATABASE_URL'] = 'postgresql://localhost/test';
    expect(getConnectionString()).toBe('postgresql://localhost/test');
  });

  it('throws when DATABASE_URL missing for pg', () => {
    process.env['DB_DIALECT'] = 'pg';
    delete process.env['DATABASE_URL'];
    expect(() => getConnectionString()).toThrow('DATABASE_URL');
  });

  it('throws when DATABASE_URL missing for mysql', () => {
    process.env['DB_DIALECT'] = 'mysql';
    delete process.env['DATABASE_URL'];
    expect(() => getConnectionString()).toThrow('DATABASE_URL');
  });
});
