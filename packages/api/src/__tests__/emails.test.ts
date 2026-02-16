import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Email Templates', () => {
  it('GET /api/v1/emails/templates -- lists templates', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/emails/templates', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Should include the default templates from mock
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/emails/templates/:slug -- returns specific template', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/emails/templates/welcome', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('welcome');
    expect(body.isDefault).toBe(true);
  });

  it('PATCH /api/v1/emails/templates/:slug -- creates override for default template', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/emails/templates/welcome', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        subject: 'Custom Welcome',
        bodyHtml: '<p>Custom welcome email</p>',
      }),
    });
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    expect(body.subject).toBe('Custom Welcome');
  });

  it('PATCH /api/v1/emails/templates/:slug -- updates existing template', async () => {
    const { token, account } = await createTestUser();
    // First create override
    await app.request('/api/v1/emails/templates/welcome', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        subject: 'First Override',
        bodyHtml: '<p>First</p>',
      }),
    });

    // Then update it
    const res = await app.request('/api/v1/emails/templates/welcome', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Account-Id': account.id,
      },
      body: JSON.stringify({
        subject: 'Second Override',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toBe('Second Override');
  });

  it('GET /api/v1/emails/templates/:slug -- returns 404 for unknown template', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/emails/templates/nonexistent-slug', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/emails/templates');
    expect(res.status).toBe(401);
  });
});
