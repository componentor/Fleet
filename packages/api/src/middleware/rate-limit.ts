import { createMiddleware } from 'hono/factory';
import { getValkey } from '../services/valkey.service.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

export function rateLimiter({ windowMs, max, keyPrefix = 'default' }: RateLimiterOptions) {
  const windowSec = Math.ceil(windowMs / 1000);

  // Per-instance in-memory fallback store
  const fallbackStore = new Map<string, RateLimitEntry>();
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function ensureCleanup() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of fallbackStore) {
        if (now > entry.resetAt) {
          fallbackStore.delete(key);
        }
      }
    }, windowMs);
    // Don't block process exit
    if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
      cleanupTimer.unref();
    }
  }

  return createMiddleware(async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown';

    const valkey = await getValkey();

    if (valkey) {
      const key = `rl:${keyPrefix}:${ip}:${windowSec}`;
      try {
        const results = await valkey.multi()
          .incr(key)
          .expire(key, windowSec)
          .exec();

        const count = (results?.[0]?.[1] as number) ?? 1;

        if (count > max) {
          const ttl = await valkey.ttl(key);
          const retryAfter = ttl > 0 ? ttl : windowSec;
          c.header('Retry-After', String(retryAfter));
          return c.json({ error: 'Too many requests', retryAfter }, 429);
        }

        await next();
        return;
      } catch {
        // Valkey command failed, fall through to in-memory
      }
    }

    // In-memory fallback
    ensureCleanup();

    const now = Date.now();
    const memKey = `${keyPrefix}:${ip}`;
    const entry = fallbackStore.get(memKey);

    if (!entry || now > entry.resetAt) {
      fallbackStore.set(memKey, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests', retryAfter }, 429);
    }

    await next();
  });
}
