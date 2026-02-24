import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Services', () => {
  it('POST /api/v1/services -- creates service', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/services', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'my-app',
        image: 'nginx:latest',
        replicas: 1,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.name).toBe('my-app');
    // Docker is mocked to succeed, so the service stays in 'deploying' status
    expect(body.status).toBe('deploying');
  });

  it('GET /api/v1/services -- lists services', async () => {
    const { token, account } = await createTestUser();
    // Create a service first
    await app.request('/api/v1/services', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'list-test',
        image: 'nginx:latest',
      }),
    });

    const res = await app.request('/api/v1/services', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/services/:id -- returns service details', async () => {
    const { token, account } = await createTestUser();
    // Create a service
    const createRes = await app.request('/api/v1/services', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'detail-test',
        image: 'nginx:latest',
      }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/api/v1/services/${created.id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('detail-test');
  });

  it('PATCH /api/v1/services/:id -- updates service', async () => {
    const { token, account } = await createTestUser();
    const createRes = await app.request('/api/v1/services', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'update-test',
        image: 'nginx:latest',
      }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/api/v1/services/${created.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        replicas: 3,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.replicas).toBe(3);
  });

  it('DELETE /api/v1/services/:id -- deletes service', async () => {
    const { token, account } = await createTestUser();
    const createRes = await app.request('/api/v1/services', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'delete-test',
        image: 'nginx:latest',
      }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/api/v1/services/${created.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.message).toContain('destroyed');
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/services');
    expect(res.status).toBe(401);
  });

  it('returns 400 without account context', async () => {
    const { token } = await createTestUser({ isSuper: false });
    const res = await app.request('/api/v1/services', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    // Non-super user without X-Account-Id gets 400 from tenant middleware
    expect(res.status).toBe(400);
  });
});
