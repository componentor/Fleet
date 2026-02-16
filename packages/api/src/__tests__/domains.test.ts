import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('DNS', () => {
  it('POST /api/v1/dns/zones -- creates zone', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/dns/zones', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        domain: 'example.com',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.domain).toBe('example.com');
    expect(body.verificationToken).toBeDefined();
  });

  it('GET /api/v1/dns/zones -- lists zones', async () => {
    const { token, account } = await createTestUser();
    // Create a zone first
    await app.request('/api/v1/dns/zones', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({ domain: 'list-test.com' }),
    });

    const res = await app.request('/api/v1/dns/zones', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/dns/zones/:id -- returns zone with records', async () => {
    const { token, account } = await createTestUser();
    const createRes = await app.request('/api/v1/dns/zones', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({ domain: 'detail-test.com' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/v1/dns/zones/${created.id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain).toBe('detail-test.com');
  });

  it('DELETE /api/v1/dns/zones/:id -- deletes zone', async () => {
    const { token, account } = await createTestUser();
    const createRes = await app.request('/api/v1/dns/zones', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({ domain: 'delete-test.com' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/v1/dns/zones/${created.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain('deleted');
  });

  it('POST /api/v1/dns/zones -- rejects duplicate domain', async () => {
    const { token, account } = await createTestUser();
    await app.request('/api/v1/dns/zones', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({ domain: 'dup.com' }),
    });

    const res = await app.request('/api/v1/dns/zones', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({ domain: 'dup.com' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST /api/v1/dns/zones -- validates domain format', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/dns/zones', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({ domain: 'not-a-valid-domain' }),
    });
    expect(res.status).toBe(400);
  });

  describe('Records', () => {
    it('POST /api/v1/dns/zones/:id/records -- creates record', async () => {
      const { token, account } = await createTestUser();
      const createRes = await app.request('/api/v1/dns/zones', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Account-Id': account.id,
        },
        body: JSON.stringify({ domain: 'records-test.com' }),
      });
      const zone = await createRes.json();

      const res = await app.request(`/api/v1/dns/zones/${zone.id}/records`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Account-Id': account.id,
        },
        body: JSON.stringify({
          type: 'A',
          name: 'www.records-test.com',
          content: '1.2.3.4',
          ttl: 3600,
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe('A');
      expect(body.content).toBe('1.2.3.4');
    });

    it('GET /api/v1/dns/zones/:id/records -- lists records', async () => {
      const { token, account } = await createTestUser();
      const createRes = await app.request('/api/v1/dns/zones', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Account-Id': account.id,
        },
        body: JSON.stringify({ domain: 'list-records.com' }),
      });
      const zone = await createRes.json();

      const res = await app.request(`/api/v1/dns/zones/${zone.id}/records`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Account-Id': account.id,
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/dns/zones');
    expect(res.status).toBe(401);
  });
});
