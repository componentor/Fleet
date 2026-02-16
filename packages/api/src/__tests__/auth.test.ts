import { describe, it, expect } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser, createAuthToken } from './setup.js';

describe('Auth', () => {
  describe('POST /api/v1/auth/register', () => {
    it('creates user and returns tokens', async () => {
      const res = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.tokens.refreshToken).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
    });

    it('rejects duplicate email', async () => {
      await createTestUser({ email: 'dup@example.com' });
      const res = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Dup User',
          email: 'dup@example.com',
          password: 'password123',
        }),
      });
      expect(res.status).toBe(409);
    });

    it('validates required fields', async () => {
      const res = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bad' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns tokens for valid credentials', async () => {
      await createTestUser({ email: 'login@example.com', password: 'mypassword' });
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'mypassword' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tokens.accessToken).toBeDefined();
    });

    it('rejects wrong password', async () => {
      await createTestUser({ email: 'wrong@example.com', password: 'correct' });
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'wrong@example.com', password: 'incorrect' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects non-existent email', async () => {
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ghost@example.com', password: 'anything' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('returns new token pair', async () => {
      const { user } = await createTestUser({ email: 'refresh@example.com' });
      const { SignJWT } = await import('jose');
      const secret = new TextEncoder().encode(process.env['JWT_SECRET']!);
      const refreshToken = await new SignJWT({ userId: user.id, type: 'refresh' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(secret);

      const res = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.tokens.refreshToken).toBeDefined();
    });

    it('rejects invalid refresh token', async () => {
      const res = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'invalid-token' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns user profile with valid token', async () => {
      const { token } = await createTestUser({ email: 'me@example.com' });
      const res = await app.request('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
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

  describe('GET /api/v1/auth/me/accounts', () => {
    it('returns accounts for authenticated user', async () => {
      const { token } = await createTestUser({ email: 'accts@example.com' });
      const res = await app.request('/api/v1/auth/me/accounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('returns success message', async () => {
      const res = await app.request('/api/v1/auth/logout', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.message).toBe('Logged out successfully');
    });
  });
});
