import { createMiddleware } from 'hono/factory';
import { getValkey } from '../services/valkey.service.js';

/**
 * Valkey-backed response cache middleware.
 * Caches JSON responses by method + path + validated accountId.
 * Uses the validated accountId from context (set by tenantMiddleware) to prevent
 * cross-tenant cache poisoning. Must run after auth + tenant middleware.
 * Skipped gracefully when Valkey is unavailable.
 */
export function cache(ttlSeconds: number) {
  return createMiddleware(async (c, next) => {
    // Only cache GET requests
    if (c.req.method !== 'GET') {
      await next();
      return;
    }

    const valkey = await getValkey();
    if (!valkey) {
      await next();
      return;
    }

    // Use validated accountId from tenant middleware (not raw header)
    const accountId = (c.get('accountId' as never) as string | undefined) ?? 'none';
    const cacheKey = `cache:${c.req.method}:${c.req.path}:${accountId}`;

    try {
      const cached = await valkey.get(cacheKey);
      if (cached) {
        c.header('X-Cache', 'HIT');
        const parsed = JSON.parse(cached) as { body: unknown; status: number };
        return c.json(parsed.body, parsed.status as 200);
      }
    } catch {
      // Cache read failed, proceed normally
    }

    await next();

    // Cache successful JSON responses
    if (c.res.status >= 200 && c.res.status < 300) {
      try {
        const body = await c.res.clone().json();
        await valkey.setex(cacheKey, ttlSeconds, JSON.stringify({ body, status: c.res.status }));
      } catch {
        // Not a JSON response or cache write failed — skip
      }
    }

    c.header('X-Cache', 'MISS');
  });
}

/**
 * Invalidate cached responses matching a prefix pattern.
 * Call this on write operations to ensure stale data is cleared.
 */
export async function invalidateCache(pattern: string): Promise<void> {
  const valkey = await getValkey();
  if (!valkey) return;

  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await valkey.scan(
        Number(cursor),
        'MATCH',
        `cache:${pattern}`,
        'COUNT',
        100,
      );
      cursor = String(nextCursor);
      if (keys.length > 0) {
        await valkey.del(...keys);
      }
    } while (cursor !== '0');
  } catch {
    // Best-effort invalidation
  }
}
