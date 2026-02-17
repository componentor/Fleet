import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser, createAuthToken } from './setup.js';

// Helper to make API requests
function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  return app.request(`/api/v1${path}`, opts);
}

// Helper to create a verified test user (for login tests)
async function createVerifiedUser(overrides: Parameters<typeof createTestUser>[0] = {}) {
  const result = await createTestUser(overrides);
  const { db, users, eq } = await import('@fleet/db');
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, result.user.id));
  return result;
}

describe('Auth', () => {
  describe('POST /auth/register', () => {
    it('creates user and returns tokens', async () => {
      const res = await req('POST', '/auth/register', {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.tokens.refreshToken).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.user.emailVerified).toBe(false);
    });

    it('rejects duplicate email', async () => {
      await createTestUser({ email: 'dup@example.com' });
      const res = await req('POST', '/auth/register', {
        name: 'Dup User',
        email: 'dup@example.com',
        password: 'password123',
      });
      expect(res.status).toBe(409);
    });

    it('validates required fields', async () => {
      const res = await req('POST', '/auth/register', { email: 'bad' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('rejects unverified email with EMAIL_NOT_VERIFIED code', async () => {
      await createTestUser({ email: 'unverified@example.com', password: 'mypassword' });
      const res = await req('POST', '/auth/login', {
        email: 'unverified@example.com',
        password: 'mypassword',
      });
      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('returns tokens for verified user', async () => {
      await createVerifiedUser({ email: 'login@example.com', password: 'mypassword' });
      const res = await req('POST', '/auth/login', {
        email: 'login@example.com',
        password: 'mypassword',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tokens.accessToken).toBeDefined();
    });

    it('rejects wrong password', async () => {
      await createVerifiedUser({ email: 'wrong@example.com', password: 'correct' });
      const res = await req('POST', '/auth/login', {
        email: 'wrong@example.com',
        password: 'incorrect',
      });
      expect(res.status).toBe(401);
    });

    it('rejects non-existent email', async () => {
      const res = await req('POST', '/auth/login', {
        email: 'ghost@example.com',
        password: 'anything',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns new token pair', async () => {
      const { user } = await createTestUser({ email: 'refresh@example.com' });
      const { SignJWT } = await import('jose');
      const secret = new TextEncoder().encode(process.env['JWT_SECRET']!);
      const refreshToken = await new SignJWT({ userId: user.id, type: 'refresh' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(secret);

      const res = await req('POST', '/auth/refresh', { refreshToken });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.tokens.refreshToken).toBeDefined();
    });

    it('rejects invalid refresh token', async () => {
      const res = await req('POST', '/auth/refresh', { refreshToken: 'invalid-token' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns user profile with valid token', async () => {
      const { token } = await createTestUser({ email: 'me@example.com' });
      const res = await req('GET', '/auth/me', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.email).toBe('me@example.com');
    });

    it('returns 401 without token', async () => {
      const res = await app.request('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /auth/me/accounts', () => {
    it('returns accounts for authenticated user', async () => {
      const { token } = await createTestUser({ email: 'accts@example.com' });
      const res = await req('GET', '/auth/me/accounts', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /auth/logout', () => {
    it('returns success message', async () => {
      const { token } = await createTestUser({ email: 'logout@example.com' });
      const res = await req('POST', '/auth/logout', undefined, {
        Authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.message).toBe('Logged out successfully');
    });

    it('returns 401 without auth token', async () => {
      const res = await req('POST', '/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('always returns 200 to prevent email enumeration', async () => {
      const res = await req('POST', '/auth/forgot-password', {
        email: 'nonexistent@example.com',
      });
      expect(res.status).toBe(200);
    });

    it('returns 200 for existing user too', async () => {
      await createTestUser({ email: 'exists@example.com' });
      const res = await req('POST', '/auth/forgot-password', {
        email: 'exists@example.com',
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('rejects invalid token', async () => {
      const res = await req('POST', '/auth/reset-password', {
        token: 'invalid-token',
        password: 'newpassword123',
      });
      expect(res.status).toBe(400);
    });

    it('rejects short passwords', async () => {
      const res = await req('POST', '/auth/reset-password', {
        token: 'some-token',
        password: 'short',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/verify-email', () => {
    it('rejects invalid token', async () => {
      const res = await req('POST', '/auth/verify-email', { token: 'bad-token' });
      expect(res.status).toBe(400);
    });
  });

  describe('2FA endpoints', () => {
    it('2fa/setup requires auth', async () => {
      const res = await req('POST', '/auth/2fa/setup');
      expect(res.status).toBe(401);
    });

    it('2fa/enable requires auth', async () => {
      const res = await req('POST', '/auth/2fa/enable', { code: '123456' });
      expect(res.status).toBe(401);
    });

    it('2fa/verify rejects invalid temp token', async () => {
      const res = await req('POST', '/auth/2fa/verify', {
        tempToken: 'invalid',
        code: '123456',
      });
      expect(res.status).toBe(401);
    });

    it('2fa/disable requires auth', async () => {
      const res = await req('POST', '/auth/2fa/disable', { code: '123456' });
      expect(res.status).toBe(401);
    });
  });
});
