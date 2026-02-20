import { db, platformSettings, eq } from '@fleet/db';
import { decrypt } from './crypto.service.js';

// Cached Google config with TTL
let _googleConfigCache: { clientId: string | null; clientSecret: string | null } | null = null;
let _googleConfigCacheTime = 0;
const GOOGLE_CONFIG_TTL_MS = 60_000; // 60s

/**
 * Resolve Google OAuth credentials.
 * Priority: DB (platformSettings) -> environment variable -> null.
 */
export async function getGoogleConfig(): Promise<{
  clientId: string | null;
  clientSecret: string | null;
}> {
  const now = Date.now();
  if (_googleConfigCache && now - _googleConfigCacheTime < GOOGLE_CONFIG_TTL_MS) {
    return _googleConfigCache;
  }

  let dbClientId: string | null = null;
  let dbClientSecret: string | null = null;

  try {
    const rows = await db.query.platformSettings.findMany({
      where: (s, { or }) =>
        or(
          eq(s.key, 'google:clientId'),
          eq(s.key, 'google:clientSecret'),
        ),
    });

    for (const row of rows) {
      const val = typeof row.value === 'string' ? row.value : null;
      if (!val) continue;
      switch (row.key) {
        case 'google:clientId':
          dbClientId = val;
          break;
        case 'google:clientSecret':
          try { dbClientSecret = decrypt(val); } catch { /* corrupt or missing key */ }
          break;
      }
    }
  } catch {
    // DB unavailable — fall through to env vars
  }

  const config = {
    clientId: dbClientId || process.env['GOOGLE_CLIENT_ID'] || null,
    clientSecret: dbClientSecret || process.env['GOOGLE_CLIENT_SECRET'] || null,
  };

  _googleConfigCache = config;
  _googleConfigCacheTime = now;

  return config;
}

/** Invalidate the cached Google config (call after saving new credentials). */
export function invalidateGoogleConfigCache(): void {
  _googleConfigCache = null;
  _googleConfigCacheTime = 0;
}
