import { createMiddleware } from 'hono/factory';
import { getConnInfo } from '@hono/node-server/conninfo';
import { getValkey } from '../services/valkey.service.js';
import { logger, logToErrorTable } from '../services/logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

/**
 * Extract the real client IP. Only trust X-Forwarded-For / X-Real-IP when
 * TRUST_PROXY=1 (i.e. the app sits behind a reverse proxy that sets these).
 * Otherwise, use the socket-level remote address to prevent spoofing.
 */
function getClientIp(c: Parameters<Parameters<typeof createMiddleware>[0]>[0]): string {
  if (process.env['TRUST_PROXY'] === '1') {
    const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) return xff;
    const xri = c.req.header('x-real-ip');
    if (xri) return xri;
  }

  try {
    const conn = getConnInfo(c);
    if (conn.remote.address) return conn.remote.address;
  } catch {
    // conninfo not available in some environments
  }

  return 'unknown';
}

export function rateLimiter({ windowMs, max, keyPrefix = 'default' }: RateLimiterOptions) {
  const windowSec = Math.ceil(windowMs / 1000);

  // Per-instance in-memory fallback store (bounded to prevent DoS memory growth)
  const MAX_FALLBACK_ENTRIES = 10_000;
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
    const ip = getClientIp(c);

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
          const reqPath = new URL(c.req.url).pathname;
          logger.warn({ ip, path: reqPath, keyPrefix, count, max }, 'Rate limit exceeded');
          logToErrorTable({
            level: 'warn',
            message: `Rate limit exceeded: ${keyPrefix} (${count}/${max})`,
            path: reqPath,
            ip,
            statusCode: 429,
            metadata: { keyPrefix, count, max },
          });
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
      // Evict oldest entries if store is full to prevent unbounded memory growth
      if (fallbackStore.size >= MAX_FALLBACK_ENTRIES) {
        const firstKey = fallbackStore.keys().next().value;
        if (firstKey) fallbackStore.delete(firstKey);
      }
      fallbackStore.set(memKey, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      const reqPath = new URL(c.req.url).pathname;
      logger.warn({ ip, path: reqPath, keyPrefix, count: entry.count, max }, 'Rate limit exceeded');
      logToErrorTable({
        level: 'warn',
        message: `Rate limit exceeded: ${keyPrefix} (${entry.count}/${max})`,
        path: reqPath,
        ip,
        statusCode: 429,
        metadata: { keyPrefix, count: entry.count, max },
      });
      return c.json({ error: 'Too many requests', retryAfter }, 429);
    }

    await next();
  });
}
