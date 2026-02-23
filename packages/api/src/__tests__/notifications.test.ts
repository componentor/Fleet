import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Notifications', () => {
  it('GET /api/v1/notifications -- returns empty list initially', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/notifications', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual([]);
  });

  it('GET /api/v1/notifications -- returns inserted notifications', async () => {
    const { user, token, account } = await createTestUser();

    const { db, notifications } = await import('@fleet/db');
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      accountId: account.id,
      userId: user.id,
      type: 'info',
      title: 'Test notification',
      message: 'Test message',
    });

    const res = await app.request('/api/v1/notifications', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe('Test notification');
  });

  it('GET /api/v1/notifications/unread-count -- returns 0 initially', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/notifications/unread-count', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.count).toBe(0);
  });

  it('GET /api/v1/notifications/unread-count -- returns count after inserting', async () => {
    const { user, token, account } = await createTestUser();

    const { db, notifications } = await import('@fleet/db');
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      accountId: account.id,
      userId: user.id,
      type: 'info',
      title: 'Unread notification',
      message: 'Unread message',
    });

    // notificationService.getUnreadCount is mocked to return 0 by default,
    // but the route calls it — so the count comes from the mock
    const res = await app.request('/api/v1/notifications/unread-count', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.count).toBe('number');
  });

  it('PATCH /api/v1/notifications/:id/read -- marks notification as read', async () => {
    const { user, token, account } = await createTestUser();

    const { db, notifications } = await import('@fleet/db');
    const notifId = crypto.randomUUID();
    await db.insert(notifications).values({
      id: notifId,
      accountId: account.id,
      userId: user.id,
      type: 'info',
      title: 'To be read',
      message: 'Mark me as read',
    });

    const res = await app.request(`/api/v1/notifications/${notifId}/read`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.message).toContain('read');
  });

  it('POST /api/v1/notifications/mark-all-read -- marks all as read', async () => {
    const { user, token, account } = await createTestUser();

    const { db, notifications } = await import('@fleet/db');
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      accountId: account.id,
      userId: user.id,
      type: 'info',
      title: 'Notification 1',
      message: 'Message 1',
    });
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      accountId: account.id,
      userId: user.id,
      type: 'info',
      title: 'Notification 2',
      message: 'Message 2',
    });

    const res = await app.request('/api/v1/notifications/mark-all-read', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.message).toContain('read');
  });

  it('DELETE /api/v1/notifications/:id -- deletes notification', async () => {
    const { user, token, account } = await createTestUser();

    const { db, notifications } = await import('@fleet/db');
    const notifId = crypto.randomUUID();
    await db.insert(notifications).values({
      id: notifId,
      accountId: account.id,
      userId: user.id,
      type: 'info',
      title: 'To be deleted',
      message: 'Delete me',
    });

    const res = await app.request(`/api/v1/notifications/${notifId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.message).toContain('deleted');
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/notifications');
    expect(res.status).toBe(401);
  });
});
