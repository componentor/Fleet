import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';
import { db, services, eq } from '@fleet/db';

// Helper to create a test service and mark it as running (so redeploy doesn't 409)
async function createTestService(token: string, accountId: string) {
  const res = await app.request('/api/v1/services', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Account-Id': accountId,
    },
    body: JSON.stringify({
      name: 'test-svc',
      image: 'nginx:latest',
    }),
  });
  const svc = await res.json() as any;
  // Service is created with status 'deploying' — transition to 'running'
  // so that redeploy (which rejects 'deploying') can proceed.
  await db.update(services).set({ status: 'running' }).where(eq(services.id, svc.id));
  return { ...svc, status: 'running' };
}

describe('Deployments', () => {
  it('GET /api/v1/deployments?serviceId=... -- returns empty list initially', async () => {
    const { token, account } = await createTestUser();
    const svc = await createTestService(token, account.id);

    const res = await app.request(`/api/v1/deployments?serviceId=${svc.id}`, {
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

  it('GET /api/v1/deployments?serviceId=... -- returns deployments after redeploy', async () => {
    const { token, account } = await createTestUser();
    const svc = await createTestService(token, account.id);

    // Redeploy the service to generate a deployment record
    const redeployRes = await app.request(`/api/v1/services/${svc.id}/redeploy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
    });
    expect(redeployRes.status).toBe(200);

    const res = await app.request(`/api/v1/deployments?serviceId=${svc.id}`, {
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

  it('GET /api/v1/deployments/:id -- returns 404 for non-existent deployment', async () => {
    const { token, account } = await createTestUser();

    const res = await app.request('/api/v1/deployments/non-existent-id', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain('not found');
  });

  it('GET /api/v1/deployments -- returns 400 without serviceId query param', async () => {
    const { token, account } = await createTestUser();

    const res = await app.request('/api/v1/deployments', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('serviceId');
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/deployments');
    expect(res.status).toBe(401);
  });

  it('returns 400 without X-Account-Id header', async () => {
    const { token } = await createTestUser({ isSuper: false });
    const res = await app.request('/api/v1/deployments', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    // Non-super user without X-Account-Id gets 400 from tenant middleware
    expect(res.status).toBe(400);
  });

  it('cross-account isolation -- user A cannot see user B deployments', async () => {
    // Create user A with a service
    const userA = await createTestUser({ email: 'usera@test.com' });
    const svcA = await createTestService(userA.token, userA.account.id);

    // Redeploy user A's service to create a deployment record
    const redeployRes = await app.request(`/api/v1/services/${svcA.id}/redeploy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': userA.account.id,
      },
    });
    expect(redeployRes.status).toBe(200);

    // Verify user A can see the deployments
    const resA = await app.request(`/api/v1/deployments?serviceId=${svcA.id}`, {
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'X-Account-Id': userA.account.id,
      },
    });
    expect(resA.status).toBe(200);
    const bodyA = await resA.json() as any;
    expect(bodyA.length).toBeGreaterThanOrEqual(1);

    // Create user B
    const userB = await createTestUser({ email: 'userb@test.com' });

    // User B tries to list deployments for user A's service -- should get 404 (service not found for their account)
    const resB = await app.request(`/api/v1/deployments?serviceId=${svcA.id}`, {
      headers: {
        Authorization: `Bearer ${userB.token}`,
        'X-Account-Id': userB.account.id,
      },
    });
    expect(resB.status).toBe(404);
    const bodyB = await resB.json() as any;
    expect(bodyB.error).toContain('not found');
  });
});
