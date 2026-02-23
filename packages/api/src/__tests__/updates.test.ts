import { describe, it, expect, vi } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

// ── Mock @fleet/db/migrate (used by update routes) ──
vi.mock('@fleet/db/migrate', () => ({
  runMigrations: vi.fn().mockResolvedValue({ applied: 0 }),
  verifyDatabase: vi.fn().mockResolvedValue({ ok: true }),
}));

// ── Mock @fleet/db/seed (used by update routes) ──
vi.mock('@fleet/db/seed', () => ({
  runSeeders: vi.fn().mockResolvedValue({ executed: 0 }),
}));

const BASE = '/api/v1/updates';

describe('Updates', () => {
  // ─── GET /notification ───────────────────────────────────────────
  it('GET /notification -- returns notification object', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/notification`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('available');
    expect(body).toHaveProperty('latest');
  });

  // ─── GET /settings ───────────────────────────────────────────────
  it('GET /settings -- returns all three settings with defaults', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('includeRcReleases');
    expect(body).toHaveProperty('autoCheckEnabled');
    expect(body).toHaveProperty('backupBeforeUpdate');
  });

  // ─── PATCH /settings -- backupBeforeUpdate ───────────────────────
  it('PATCH /settings -- saves backupBeforeUpdate toggle', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ backupBeforeUpdate: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.backupBeforeUpdate).toBe(false);
    expect(body.message).toBeDefined();
  });

  // ─── PATCH /settings -- includeRcReleases ────────────────────────
  it('PATCH /settings -- saves includeRcReleases toggle', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ includeRcReleases: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.includeRcReleases).toBe(true);
    expect(body.message).toBeDefined();
  });

  // ─── GET /status ─────────────────────────────────────────────────
  it('GET /status -- returns idle state by default', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('idle');
    expect(body.currentVersion).toBeDefined();
  });

  // ─── POST /perform -- valid version ──────────────────────────────
  it('POST /perform -- starts update with valid version', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/perform`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version: '1.2.0' }),
    });
    expect(res.status).toBe(202);
    const body = await res.json() as any;
    expect(body.status).toBe('started');
    expect(body.message).toBeDefined();
  });

  // ─── POST /perform -- missing version ────────────────────────────
  it('POST /perform -- rejects without version (400)', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/perform`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  // ─── POST /reset -- rejects when idle ────────────────────────────
  it('POST /reset -- rejects when system is idle (400)', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
    expect(body.currentStatus).toBe('idle');
  });

  // ─── GET /releases ───────────────────────────────────────────────
  it('GET /releases -- returns releases array', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/releases`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.releases)).toBe(true);
    expect(body).toHaveProperty('rcEnabled');
  });

  // ─── GET /db-status ──────────────────────────────────────────────
  it('GET /db-status -- returns ok status', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request(`${BASE}/db-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  // ─── 403 for non-super user ──────────────────────────────────────
  it('returns 403 for non-super user on all endpoints', async () => {
    const { token } = await createTestUser({ isSuper: false });

    const endpoints = [
      { path: `${BASE}/notification`, method: 'GET' },
      { path: `${BASE}/settings`, method: 'GET' },
      { path: `${BASE}/settings`, method: 'PATCH' },
      { path: `${BASE}/status`, method: 'GET' },
      { path: `${BASE}/perform`, method: 'POST' },
      { path: `${BASE}/reset`, method: 'POST' },
      { path: `${BASE}/releases`, method: 'GET' },
      { path: `${BASE}/db-status`, method: 'GET' },
    ] as const;

    for (const { path, method } of endpoints) {
      const res = await app.request(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(method === 'POST' || method === 'PATCH'
          ? { body: JSON.stringify({}) }
          : {}),
      });
      expect(res.status).toBe(403);
    }
  });

  // ─── 401 without auth ────────────────────────────────────────────
  it('returns 401 without auth', async () => {
    const res = await app.request(`${BASE}/notification`);
    expect(res.status).toBe(401);
  });
});
