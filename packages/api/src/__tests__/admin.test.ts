import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Admin', () => {
  it('GET /api/v1/admin/stats -- returns stats for super user', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/admin/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.accounts).toBeDefined();
    expect(body.users).toBeDefined();
    expect(body.services).toBeDefined();
  });

  it('GET /api/v1/admin/stats -- returns 403 for non-super user', async () => {
    const { token } = await createTestUser({ isSuper: false });
    const res = await app.request('/api/v1/admin/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/v1/admin/users -- lists all users (admin only)', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
  });

  it('GET /api/v1/admin/users -- does not expose password hashes', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as any;
    for (const user of body.data) {
      expect(user.passwordHash).toBeUndefined();
    }
  });

  it('GET /api/v1/admin/accounts -- lists all accounts', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/admin/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
  });

  it('PATCH /api/v1/admin/users/:id/super -- toggles super status', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const { user: targetUser } = await createTestUser({ email: 'target@example.com', isSuper: false });

    const res = await app.request(`/api/v1/admin/users/${targetUser.id}/super`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.isSuper).toBe(true);
  });

  it('PATCH /api/v1/admin/users/:id/super -- prevents self-modification', async () => {
    const { token, user } = await createTestUser({ isSuper: true });
    const res = await app.request(`/api/v1/admin/users/${user.id}/super`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/v1/admin/users/:id/super -- returns 404 for unknown user', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/admin/users/nonexistent-id/super', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/v1/admin/audit-log -- returns audit log', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/admin/audit-log', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /api/v1/admin/services -- lists all services across accounts', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/admin/services', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/admin/stats');
    expect(res.status).toBe(401);
  });
});
