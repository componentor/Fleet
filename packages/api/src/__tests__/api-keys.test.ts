import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('API Keys', () => {
  it('GET /api/v1/api-keys -- returns empty list initially', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/api-keys', {
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

  it('POST /api/v1/api-keys -- creates key and returns the raw key', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'My API Key',
        scopes: ['read', 'write'],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.name).toBe('My API Key');
    expect(body.key).toBeDefined();
    expect(body.key).toMatch(/^fleet_/);
    expect(body.keyPrefix).toBeDefined();
    expect(body.scopes).toEqual(['read', 'write']);
  });

  it('GET /api/v1/api-keys -- returns created key without raw key', async () => {
    const { token, account } = await createTestUser();

    // Create a key first
    await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'Listed Key',
        scopes: ['read'],
      }),
    });

    const res = await app.request('/api/v1/api-keys', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].name).toBe('Listed Key');
    expect(body[0].keyPrefix).toBeDefined();
    // The raw key should NOT be returned in the list
    expect(body[0].key).toBeUndefined();
  });

  it('DELETE /api/v1/api-keys/:id -- revokes/deletes key', async () => {
    const { token, account } = await createTestUser();

    // Create a key first
    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'Key to revoke',
        scopes: ['read'],
      }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/api/v1/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.message).toContain('revoked');
  });

  it('DELETE /api/v1/api-keys/:id -- returns 404 for non-existent', async () => {
    const { token, account } = await createTestUser();
    const fakeId = crypto.randomUUID();
    const res = await app.request(`/api/v1/api-keys/${fakeId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/api-keys');
    expect(res.status).toBe(401);
  });
});
