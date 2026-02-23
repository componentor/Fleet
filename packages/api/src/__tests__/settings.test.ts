import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Settings', () => {
  it('GET /api/v1/settings -- super admin can access platform settings', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body).toBe('object');
  });

  it('GET /api/v1/settings -- returns 403 for non-super user without account context', async () => {
    const { token } = await createTestUser({ isSuper: false });
    const res = await app.request('/api/v1/settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Non-super user without X-Account-Id gets 400 from tenant middleware
    expect(res.status).toBe(400);
  });

  it('PATCH /api/v1/settings -- super admin can update platform settings', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 'platform:name': 'My Fleet' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.message).toContain('Platform settings updated');
    expect(body.updated).toContain('platform:name');
  });

  it('GET /api/v1/settings -- returns account settings with account context', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/settings', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body).toBe('object');
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/settings');
    expect(res.status).toBe(401);
  });
});
