import { createMiddleware } from 'hono/factory';
import { getValkey } from '../services/valkey.service.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

// In-memory fallback when Valkey is unavailable
const fallbackStore = new Map<string, RateLimitEntry>();
let fallbackCleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureFallbackCleanup(windowMs: number) {
  if (fallbackCleanupTimer) return;
  fallbackCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of fallbackStore) {
      if (now > entry.resetAt) {
        fallbackStore.delete(key);
      }
    }
  }, windowMs);
}

export function rateLimiter({ windowMs, max }: RateLimiterOptions) {
  const windowSec = Math.ceil(windowMs / 1000);

  return createMiddleware(async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown';

    const valkey = await getValkey();

    if (valkey) {
      // Redis-backed rate limiting with INCR + EXPIRE
      const key = `rl:${ip}:${windowSec}`;
      try {
        const results = await valkey.multi()
          .incr(key)
          .expire(key, windowSec)
          .exec();

        const count = (results?.[0]?.[1] as number) ?? 1;

        if (count > max) {
          const ttl = await valkey.ttl(key);
          c.header('Retry-After', String(ttl > 0 ? ttl : windowSec));
          return c.json({ error: 'Too many requests' }, 429);
        }

        await next();
        return;
      } catch {
        // Valkey command failed, fall through to in-memory
      }
    }

    // In-memory fallback
    ensureFallbackCleanup(windowMs);

    const now = Date.now();
    const entry = fallbackStore.get(ip);

    if (!entry || now > entry.resetAt) {
      fallbackStore.set(ip, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    entry.count++;

    if (entry.count > max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json({ error: 'Too many requests' }, 429);
    }

    await next();
  });
}
