import { describe, it, expect } from 'vitest';
import { resetDb, createTestUser } from './setup.js';

// Import the app AFTER mocks are registered
const { app } = await import('../app.js');

describe('Setup API', () => {
  describe('GET /api/v1/setup/status', () => {
    it('should return needsSetup: true when no users exist', async () => {
      const res = await app.request('/api/v1/setup/status');
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.needsSetup).toBe(true);
    });

    it('should return needsSetup: false when users exist', async () => {
      await createTestUser();

      const res = await app.request('/api/v1/setup/status');
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.needsSetup).toBe(false);
    });
  });

  describe('POST /api/v1/setup', () => {
    it('should create super admin and return tokens', async () => {
      const res = await app.request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin User',
          email: 'admin@example.com',
          password: 'securepass123',
          domain: 'panel.example.com',
          platformName: 'My Platform',
        }),
      });

      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.tokens).toBeDefined();
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe('admin@example.com');
      expect(data.user.name).toBe('Admin User');
      expect(data.user.isSuper).toBe(true);
    });

    it('should work without optional fields', async () => {
      const res = await app.request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin',
          email: 'admin@test.com',
          password: 'password123',
        }),
      });

      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.user.email).toBe('admin@test.com');
    });

    it('should reject if setup already completed (users exist)', async () => {
      await createTestUser();

      const res = await app.request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin',
          email: 'admin@test.com',
          password: 'password123',
        }),
      });

      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe('Setup has already been completed');
    });

    it('should reject invalid email', async () => {
      const res = await app.request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin',
          email: 'not-an-email',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject short password', async () => {
      const res = await app.request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin',
          email: 'admin@test.com',
          password: 'short',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject missing required fields', async () => {
      const res = await app.request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should return needsSetup: false after setup completes', async () => {
      // Perform setup
      await app.request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin',
          email: 'admin@test.com',
          password: 'password123',
        }),
      });

      // Check status
      const res = await app.request('/api/v1/setup/status');
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.needsSetup).toBe(false);
    });
  });
});
