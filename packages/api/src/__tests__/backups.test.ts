import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Backups', () => {
  it('GET /api/v1/backups -- returns empty list initially', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/backups', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('POST /api/v1/backups -- creates a backup', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        storageBackend: 'nfs',
      }),
    });
    // The mocked backupService.createBackup returns { id: 'backup-1' }
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBe('backup-1');
  });

  it('POST /api/v1/backups -- creates a backup with serviceId', async () => {
    const { token, account } = await createTestUser();
    // Create a service first
    const createSvc = await app.request('/api/v1/services', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'backup-target',
        image: 'nginx:latest',
      }),
    });
    const svc = await createSvc.json() as any;

    const res = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        serviceId: svc.id,
        storageBackend: 'nfs',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
  });

  it('DELETE /api/v1/backups/:id -- returns 404 for non-existent ID', async () => {
    const { token, account } = await createTestUser();
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.request(`/api/v1/backups/${fakeId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    // The mocked backupService.getBackup returns null, so the route returns 404
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain('not found');
  });

  it('GET /api/v1/backups/:id -- returns 404 for non-existent backup', async () => {
    const { token, account } = await createTestUser();
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.request(`/api/v1/backups/${fakeId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain('not found');
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/backups');
    expect(res.status).toBe(401);
  });

  it('returns 400 without account context', async () => {
    const { token } = await createTestUser({ isSuper: false });
    const res = await app.request('/api/v1/backups', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    // Non-super user without X-Account-Id gets 400 from tenant middleware
    expect(res.status).toBe(400);
  });

  it('cross-account isolation -- user A cannot access user B backups', async () => {
    const userA = await createTestUser({ email: 'user-a@test.com' });
    const userB = await createTestUser({ email: 'user-b@test.com' });

    // User A creates a backup
    const createRes = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': userA.account.id,
      },
      body: JSON.stringify({ storageBackend: 'nfs' }),
    });
    expect(createRes.status).toBe(201);

    // User B lists their own backups -- should be empty (mocked listBackups returns [])
    const listRes = await app.request('/api/v1/backups', {
      headers: {
        Authorization: `Bearer ${userB.token}`,
        'X-Account-Id': userB.account.id,
      },
    });
    expect(listRes.status).toBe(200);
    const body = await listRes.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('cross-account isolation -- user B cannot delete user A backup', async () => {
    const userA = await createTestUser({ email: 'cross-a@test.com' });
    const userB = await createTestUser({ email: 'cross-b@test.com' });

    // User B tries to delete a backup using user A's account context -- should be rejected
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const res = await app.request(`/api/v1/backups/${fakeId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${userB.token}`,
        'X-Account-Id': userA.account.id,
      },
    });
    // User B is not a member of user A's account, so tenant middleware rejects
    expect(res.status).toBe(403);
  });

  describe('Schedules', () => {
    it('GET /api/v1/backups/schedules -- returns empty list initially', async () => {
      const { token, account } = await createTestUser();
      const res = await app.request('/api/v1/backups/schedules', {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Account-Id': account.id,
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    });

    it('POST /api/v1/backups/schedules -- creates a schedule', async () => {
      const { token, account } = await createTestUser();
      const res = await app.request('/api/v1/backups/schedules', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Account-Id': account.id,
        },
        body: JSON.stringify({
          cron: '0 2 * * *',
          retentionDays: 7,
          retentionCount: 5,
          storageBackend: 'nfs',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.id).toBe('schedule-1');
    });

    it('POST /api/v1/backups/schedules -- rejects invalid cron', async () => {
      const { token, account } = await createTestUser();
      const res = await app.request('/api/v1/backups/schedules', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Account-Id': account.id,
        },
        body: JSON.stringify({
          cron: 'not-a-cron',
          retentionDays: 7,
        }),
      });
      expect(res.status).toBe(400);
    });
  });
});
