import { db, platformSettings, eq } from '@fleet/db';

// Cached platform URL from DB settings (refreshes every 60s)
let _appUrlCache: string | null = null;
let _appUrlCacheTime = 0;
const APP_URL_CACHE_TTL = 60_000;

/**
 * Get the platform URL from DB settings, falling back to APP_URL env var.
 * Cached for 60 seconds to avoid repeated DB queries.
 */
export async function getAppUrl(): Promise<string> {
  const now = Date.now();
  if (_appUrlCache && now - _appUrlCacheTime < APP_URL_CACHE_TTL) {
    return _appUrlCache;
  }
  try {
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'platform:url'),
    });
    const val = row?.value as string | undefined;
    if (val) {
      _appUrlCache = val.replace(/\/+$/, '');
      _appUrlCacheTime = now;
      return _appUrlCache;
    }
  } catch {}
  return process.env['APP_URL'] ?? 'http://localhost:5173';
}

/**
 * Synchronous getter that returns the cached platform URL or falls back to APP_URL env var.
 * Use this only in synchronous contexts (e.g. redirect URL validation).
 * The cache is populated by getAppUrl() calls in auth/email flows.
 */
export function getAppUrlSync(): string {
  return _appUrlCache ?? process.env['APP_URL'] ?? 'http://localhost:5173';
}

// Warm the cache at module load so getAppUrlSync() returns the DB value immediately
getAppUrl().catch(() => {});
