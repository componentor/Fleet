import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  return app.request(`/api/v1${path}`, opts);
}

async function createUserWithRole(role: string) {
  const result = await createTestUser();
  // Update the user_accounts role
  const { db, userAccounts, eq, and } = await import('@fleet/db');
  await db.update(userAccounts).set({ role }).where(
    and(
      eq(userAccounts.userId, result.user.id),
      eq(userAccounts.accountId, result.account.id),
    ),
  );
  return result;
}

describe('RBAC', () => {
  describe('Service management', () => {
    it('owner can create services', async () => {
      const { token, account } = await createTestUser();
      const res = await req('POST', '/services', {
        name: 'test-svc',
        image: 'nginx:latest',
      }, {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      });

      // Should succeed (201 or 200)
      expect([200, 201]).toContain(res.status);
    });

    it('viewer cannot create services', async () => {
      const { token, account } = await createUserWithRole('viewer');
      const res = await req('POST', '/services', {
        name: 'test-svc',
        image: 'nginx:latest',
      }, {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      });

      expect(res.status).toBe(403);
    });
  });

  describe('Admin routes', () => {
    it('non-super user cannot access admin endpoints', async () => {
      const { token } = await createTestUser({ isSuper: false });
      const res = await req('GET', '/admin/stats', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(403);
    });

    it('super user can access admin endpoints', async () => {
      const { token } = await createTestUser({ isSuper: true });
      const res = await req('GET', '/admin/stats', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(200);
    });
  });

  describe('Error tracking routes', () => {
    it('non-super user cannot access error logs', async () => {
      const { token } = await createTestUser({ isSuper: false });
      const res = await req('GET', '/errors', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(403);
    });

    it('super user can access error logs', async () => {
      const { token } = await createTestUser({ isSuper: true });
      const res = await req('GET', '/errors', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toBeDefined();
      expect(body.pagination).toBeDefined();
    });
  });
});
