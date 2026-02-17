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

describe('Billing', () => {
  describe('GET /billing/plans', () => {
    it('returns visible plans', async () => {
      // Insert a test plan
      const { db, billingPlans } = await import('@fleet/db');
      await db.insert(billingPlans).values({
        name: 'Starter',
        slug: 'starter',
        cpuLimit: 1000,
        memoryLimit: 512,
        containerLimit: 5,
        storageLimit: 10,
        priceCents: 1000,
        visible: true,
      });

      const { token, account } = await createTestUser();
      const res = await req('GET', '/billing/plans', undefined, {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].slug).toBe('starter');
    });

    it('does not return hidden plans', async () => {
      const { db, billingPlans } = await import('@fleet/db');
      await db.insert(billingPlans).values({
        name: 'Hidden',
        slug: 'hidden',
        cpuLimit: 1000,
        memoryLimit: 512,
        containerLimit: 5,
        storageLimit: 10,
        priceCents: 5000,
        visible: false,
      });

      const { token, account } = await createTestUser();
      const res = await req('GET', '/billing/plans', undefined, {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const hiddenPlan = body.find((p: any) => p.slug === 'hidden');
      expect(hiddenPlan).toBeUndefined();
    });
  });

  describe('GET /billing/config', () => {
    it('returns billing config when authenticated', async () => {
      const { token, account } = await createTestUser();
      const res = await req('GET', '/billing/config', undefined, {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      });

      expect(res.status).toBe(200);
    });
  });

  describe('Webhook idempotency', () => {
    it('rejects webhooks without signature', async () => {
      const res = await req('POST', '/billing/webhook', { type: 'test' });
      expect(res.status).toBe(400);
    });
  });
});
