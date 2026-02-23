import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';

describe('Marketplace', () => {
  it('GET /api/v1/marketplace/templates -- returns empty list initially', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/marketplace/templates', {
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

  it('GET /api/v1/marketplace/templates -- returns templates after seeding', async () => {
    const { templateService } = await import('../services/template.service.js');
    const { vi } = await import('vitest');
    (templateService.listTemplates as any).mockResolvedValueOnce([
      {
        id: crypto.randomUUID(),
        slug: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        iconUrl: 'https://example.com/icon.png',
        category: 'web',
        composeTemplate: 'version: "3.8"\nservices:\n  app:\n    image: nginx:latest',
        variables: '[]',
        isBuiltin: false,
      },
    ]);

    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/marketplace/templates', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].slug).toBe('test-template');
  });

  it('GET /api/v1/marketplace/templates/:slug -- returns template details', async () => {
    const { templateService } = await import('../services/template.service.js');
    const composeTemplate = 'version: "3.8"\nservices:\n  app:\n    image: nginx:latest';
    (templateService.getTemplate as any).mockResolvedValueOnce({
      id: crypto.randomUUID(),
      slug: 'test-template',
      name: 'Test Template',
      description: 'A test template',
      iconUrl: 'https://example.com/icon.png',
      category: 'web',
      composeTemplate,
      variables: '[]',
      isBuiltin: false,
    });
    (templateService.parseTemplate as any) = () => ({
      services: { app: { image: 'nginx:latest' } },
      volumes: {},
    });

    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/marketplace/templates/test-template', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.slug).toBe('test-template');
    expect(body.name).toBe('Test Template');
    expect(body.serviceDefinitions).toBeDefined();
  });

  it('GET /api/v1/marketplace/templates/:slug -- returns 404 for non-existent slug', async () => {
    const { token, account } = await createTestUser();
    const res = await app.request('/api/v1/marketplace/templates/non-existent-template', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Account-Id': account.id,
      },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain('not found');
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/v1/marketplace/templates');
    expect(res.status).toBe(401);
  });
});
