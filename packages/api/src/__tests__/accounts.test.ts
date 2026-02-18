import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Accounts', () => {
  it('GET /api/v1/accounts -- lists accounts for authenticated user', async () => {
    const { token } = await createTestUser();
    const res = await app.request('/api/v1/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/accounts -- super user sees all accounts', async () => {
    const { token } = await createTestUser({ isSuper: true });
    // Create a second user with their own account
    await createTestUser({ email: 'other@example.com' });
    const res = await app.request('/api/v1/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /api/v1/accounts -- creates sub-account', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/accounts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        name: 'Sub Account',
        parentId: account.id,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.name).toBe('Sub Account');
    expect(body.parentId).toBe(account.id);
  });

  it('GET /api/v1/accounts/:id -- returns account details', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request(`/api/v1/accounts/${account.id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(account.id);
  });

  it('PATCH /api/v1/accounts/:id -- updates account name', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request(`/api/v1/accounts/${account.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('Updated Name');
  });

  it('DELETE /api/v1/accounts/:id -- deletes account', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request(`/api/v1/accounts/${account.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({ password: 'password123' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.message).toContain('deleted');
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/accounts');
    expect(res.status).toBe(401);
  });

  describe('Members', () => {
    it('GET /api/v1/accounts/:id/members -- lists members', async () => {
      const { token, account } = await createTestUser();
      const res = await app.request(`/api/v1/accounts/${account.id}/members`, {
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

    it('POST /api/v1/accounts/:id/members -- invites member', async () => {
      const { token, account } = await createTestUser();
      // Create the user to invite
      const { user: invitee } = await createTestUser({ email: 'invitee@example.com' });

      const res = await app.request(`/api/v1/accounts/${account.id}/members`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Account-Id': account.id,
        },
        body: JSON.stringify({
          email: 'invitee@example.com',
          role: 'member',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.email).toBe('invitee@example.com');
    });
  });
});
