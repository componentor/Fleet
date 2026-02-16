import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Nodes', () => {
  it('POST /api/v1/nodes -- registers node (super only)', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const res = await app.request('/api/v1/nodes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname: 'node-1',
        ipAddress: '10.0.0.1',
        role: 'worker',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.node.hostname).toBe('node-1');
    expect(body.joinToken).toBe('worker-token');
  });

  it('GET /api/v1/nodes -- lists nodes', async () => {
    const { token } = await createTestUser({ isSuper: true });
    // Create a node first
    await app.request('/api/v1/nodes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname: 'list-node',
        ipAddress: '10.0.0.2',
        role: 'worker',
      }),
    });

    const res = await app.request('/api/v1/nodes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/nodes/:id -- returns node details', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const createRes = await app.request('/api/v1/nodes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname: 'detail-node',
        ipAddress: '10.0.0.3',
        role: 'worker',
      }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/api/v1/nodes/${created.node.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.hostname).toBe('detail-node');
  });

  it('PATCH /api/v1/nodes/:id -- updates node', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const createRes = await app.request('/api/v1/nodes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname: 'update-node',
        ipAddress: '10.0.0.4',
        role: 'worker',
      }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/api/v1/nodes/${created.node.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        labels: { env: 'production' },
      }),
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/v1/nodes/:id -- removes node', async () => {
    const { token } = await createTestUser({ isSuper: true });
    const createRes = await app.request('/api/v1/nodes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname: 'delete-node',
        ipAddress: '10.0.0.5',
        role: 'worker',
      }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/api/v1/nodes/${created.node.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.message).toContain('removed');
  });

  it('returns 403 for non-super user', async () => {
    const { token } = await createTestUser({ isSuper: false });
    const res = await app.request('/api/v1/nodes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/nodes');
    expect(res.status).toBe(401);
  });
});
