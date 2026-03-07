/**
 * ============================================================================
 * UPGRADE GUARD — ROCK-SOLID UPGRADE RESILIENCE FRAMEWORK
 * ============================================================================
 *
 * DO NOT MODIFY THIS FILE unless you are fixing a critical bug.
 *
 * This is the platform's upgrade safety net. Every function here has been
 * hardened against real production failures. Changing behavior here can
 * make the platform un-upgradable, which is the WORST possible outcome.
 *
 * If you need to add a new readiness check, add it to checkUpgradeReadiness()
 * as a new parallel check. Do not change existing check behavior.
 *
 * If you need to change retry behavior, think twice. The defaults were
 * chosen based on real-world Docker Swarm and database failure patterns.
 *
 * ============================================================================
 *
 * This module provides:
 * 1. Pre-flight readiness checks — validate ALL prerequisites before touching anything
 * 2. Retry with exponential backoff — transient failures never kill upgrades
 * 3. Self-test on startup — validates the upgrade system itself works
 * 4. Upgrade readiness report — dashboard visibility into what would block an upgrade
 *
 * Philosophy: An upgrade must ALWAYS succeed. If any non-critical step fails,
 * degrade gracefully and continue. The only hard stops are:
 * - Database is unreachable (nothing works without the DB)
 * - Distributed lock is held by another instance (concurrent protection)
 */

import { logger } from './logger.js';

// ── Retry with Exponential Backoff ──────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Initial delay in ms before first retry. Default: 1000 */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms. Default: 15000 */
  maxDelayMs?: number;
  /** Multiplier for each subsequent delay. Default: 2 */
  backoffFactor?: number;
  /** If true, add random jitter to avoid thundering herd. Default: true */
  jitter?: boolean;
  /** Optional function to decide if an error is retryable. Default: all errors */
  isRetryable?: (err: unknown) => boolean;
  /** Label for logging. Default: 'operation' */
  label?: string;
}

/**
 * Retry an async operation with exponential backoff.
 * Use this for any operation that can fail due to transient issues
 * (network timeouts, Docker API flakes, GitHub rate limits, etc.)
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 15_000,
    backoffFactor = 2,
    jitter = true,
    isRetryable = () => true,
    label = 'operation',
  } = opts;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxAttempts || !isRetryable(err)) {
        break;
      }

      const jitterMs = jitter ? Math.random() * delay * 0.3 : 0;
      const waitMs = Math.min(delay + jitterMs, maxDelayMs);
      logger.warn(
        { attempt, maxAttempts, waitMs: Math.round(waitMs), label, error: err instanceof Error ? err.message : String(err) },
        `Retrying ${label} (attempt ${attempt}/${maxAttempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }

  throw lastError;
}

// ── Pre-flight Readiness Checks ─────────────────────────────────────────────

export interface ReadinessCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  /** If true, this check failing will block the upgrade */
  critical: boolean;
  /** Time taken for this check in ms */
  durationMs: number;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
  timestamp: string;
}

/**
 * Run all pre-flight checks and return a comprehensive report.
 * This can be called from a dashboard endpoint BEFORE starting an upgrade
 * to show the user what's ready and what's not.
 */
export async function checkUpgradeReadiness(): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];

  // Run all checks in parallel for speed
  const results = await Promise.allSettled([
    runCheck('Database connectivity', true, checkDatabase),
    runCheck('Database migrations', false, checkMigrations),
    runCheck('Docker Swarm access', true, checkDockerSwarm),
    runCheck('Fleet services running', true, checkFleetServices),
    runCheck('Backup system', false, checkBackupSystem),
    runCheck('GitHub API access', false, checkGitHubAccess),
    runCheck('Disk space', false, checkDiskSpace),
    runCheck('Update lock', true, checkUpdateLock),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      checks.push(result.value);
    } else {
      checks.push({
        name: 'Unknown check',
        status: 'fail',
        message: `Check crashed: ${result.reason}`,
        critical: false,
        durationMs: 0,
      });
    }
  }

  // Ready = no critical checks failed
  const ready = checks.every((c) => c.status !== 'fail' || !c.critical);

  return {
    ready,
    checks,
    timestamp: new Date().toISOString(),
  };
}

async function runCheck(
  name: string,
  critical: boolean,
  fn: () => Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }>,
): Promise<ReadinessCheck> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<{ status: 'fail' | 'warn'; message: string }>((resolve) =>
        setTimeout(() => resolve({ status: critical ? 'fail' : 'warn', message: `Check timed out after 10s` }), 10_000),
      ),
    ]);
    return { name, critical, durationMs: Date.now() - start, ...result };
  } catch (err) {
    return {
      name,
      status: critical ? 'fail' : 'warn',
      message: `Check error: ${err instanceof Error ? err.message : String(err)}`,
      critical,
      durationMs: Date.now() - start,
    };
  }
}

async function checkDatabase(): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  const { verifyDatabase } = await import('@fleet/db/migrate');
  const result = await verifyDatabase();
  if (result.ok) return { status: 'pass', message: 'Database is reachable and healthy' };
  return { status: 'fail', message: `Database check failed: ${result.error}` };
}

async function checkMigrations(): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  // Just verify the migration system is loadable — actual migration count comes during update
  try {
    await import('@fleet/db/migrate');
    return { status: 'pass', message: 'Migration system is available' };
  } catch (err) {
    return { status: 'warn', message: `Migration module failed to load: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkDockerSwarm(): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  try {
    const { getOrchestrator } = await import('./orchestrator.js');
    const orch = getOrchestrator('swarm');
    const services = await orch.listServices({});
    return { status: 'pass', message: `Docker Swarm accessible (${services.length} services)` };
  } catch (err) {
    return { status: 'fail', message: `Docker Swarm unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkFleetServices(): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  try {
    const { getOrchestrator } = await import('./orchestrator.js');
    const orch = getOrchestrator('swarm');
    const expected = ['fleet_api', 'fleet_dashboard', 'fleet_ssh-gateway', 'fleet_agent'];
    const found: string[] = [];
    const missing: string[] = [];

    for (const name of expected) {
      const services = await orch.listServices({ name: [name] });
      if (services.length > 0) {
        found.push(name);
      } else {
        missing.push(name);
      }
    }

    if (missing.length === 0) {
      return { status: 'pass', message: `All ${expected.length} Fleet services found` };
    }
    if (found.length > 0) {
      return { status: 'warn', message: `Missing services: ${missing.join(', ')}` };
    }
    return { status: 'fail', message: 'No Fleet services found in Swarm' };
  } catch (err) {
    return { status: 'fail', message: `Cannot check services: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkBackupSystem(): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  const { access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // Check NFS first
  const nfsDir = process.env['NFS_BACKUP_DIR'] ?? '/srv/nfs/backups';
  try {
    await access(nfsDir);
    return { status: 'pass', message: `NFS backup directory accessible: ${nfsDir}` };
  } catch { /* NFS not available */ }

  // Check local backup dir
  const localDir = process.env['BACKUP_DIR'] ?? (
    process.env['NODE_ENV'] === 'production' ? '/app/data/backups' : join(tmpdir(), 'fleet-backups')
  );
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(localDir, { recursive: true });
    return { status: 'pass', message: `Local backup directory ready: ${localDir}` };
  } catch (err) {
    return { status: 'warn', message: `Backup directory not writable: ${localDir} — ${err instanceof Error ? err.message : String(err)}. Upgrades will skip backup.` };
  }
}

async function checkGitHubAccess(): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  const repo = process.env['FLEET_GITHUB_REPO'] ?? 'componentor/fleet';
  const token = process.env['GITHUB_TOKEN'] ?? '';

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fleet-upgrade-guard',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=1`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );

    if (res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining && parseInt(remaining, 10) < 10) {
        return { status: 'warn', message: `GitHub accessible but low rate limit (${remaining} remaining)` };
      }
      return { status: 'pass', message: `GitHub API accessible${token ? ' (authenticated)' : ' (unauthenticated)'}` };
    }

    if (res.status === 403 || res.status === 429) {
      return { status: 'warn', message: `GitHub rate limited (${res.status}). Upgrade can proceed without checksums.` };
    }

    return { status: 'warn', message: `GitHub API returned ${res.status}. Upgrade can proceed without checksums.` };
  } catch (err) {
    return { status: 'warn', message: `GitHub unreachable: ${err instanceof Error ? err.message : String(err)}. Upgrade can proceed without checksums.` };
  }
}

async function checkDiskSpace(): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(execFile);
    const { stdout } = await execAsync('df', ['-h', '/']);
    const lines = stdout.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1]!.split(/\s+/);
      const usePercent = parseInt(parts[4] ?? '0', 10);
      const available = parts[3] ?? 'unknown';
      if (usePercent > 95) {
        return { status: 'fail', message: `Disk nearly full (${usePercent}% used, ${available} free)` };
      }
      if (usePercent > 85) {
        return { status: 'warn', message: `Disk usage high (${usePercent}% used, ${available} free)` };
      }
      return { status: 'pass', message: `Disk OK (${usePercent}% used, ${available} free)` };
    }
    return { status: 'pass', message: 'Disk check completed' };
  } catch {
    return { status: 'pass', message: 'Disk check skipped (non-critical)' };
  }
}

async function checkUpdateLock(): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  try {
    const { db, platformSettings, eq } = await import('@fleet/db');
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'system:update_lock'),
    });

    if (!row?.value || typeof row.value !== 'object') {
      return { status: 'pass', message: 'No update lock held' };
    }

    const lock = row.value as { lockedAt?: string; lockedBy?: string } | Record<string, never>;
    if (!('lockedAt' in lock) || !lock.lockedAt) {
      return { status: 'pass', message: 'No update lock held' };
    }

    const lockAge = Date.now() - new Date(lock.lockedAt).getTime();
    const staleMs = 30 * 60 * 1000;

    if (lockAge > staleMs) {
      return { status: 'warn', message: `Stale update lock from ${lock.lockedBy ?? 'unknown'} (${Math.round(lockAge / 60000)}min ago) — will be overridden` };
    }

    return { status: 'fail', message: `Update lock held by ${lock.lockedBy ?? 'unknown'} (${Math.round(lockAge / 1000)}s ago)` };
  } catch (err) {
    return { status: 'warn', message: `Cannot check lock: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Startup Self-Test ───────────────────────────────────────────────────────

/**
 * Run on every API startup to validate the upgrade system is functional.
 * This is NOT a full readiness check — it's a fast smoke test that logs
 * warnings if something looks wrong, so admins are aware before they try
 * to upgrade and it fails.
 */
export async function upgradeSystemSelfTest(): Promise<void> {
  const issues: string[] = [];

  // 1. Can we reach the DB? (most critical)
  try {
    const { verifyDatabase } = await import('@fleet/db/migrate');
    const result = await verifyDatabase();
    if (!result.ok) {
      issues.push(`Database health check failed: ${result.error}`);
    }
  } catch (err) {
    issues.push(`Cannot load migration module: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Can we load the migration runner?
  try {
    const { runMigrations } = await import('@fleet/db/migrate');
    if (typeof runMigrations !== 'function') {
      issues.push('runMigrations is not a function');
    }
  } catch (err) {
    issues.push(`Migration runner not loadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Is there a stale lock?
  try {
    const { db, platformSettings, eq } = await import('@fleet/db');
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'system:update_lock'),
    });
    const lock = row?.value as { lockedAt?: string; lockedBy?: string } | null;
    if (lock?.lockedAt) {
      const lockAge = Date.now() - new Date(lock.lockedAt).getTime();
      if (lockAge > 30 * 60 * 1000) {
        issues.push(`Stale update lock detected (${Math.round(lockAge / 60000)}min old from ${lock.lockedBy ?? 'unknown'})`);
      }
    }
  } catch {
    // DB not ready yet — will be checked later
  }

  // 4. Check backup directory accessibility
  try {
    const { access, mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const backupDir = process.env['BACKUP_DIR'] ?? (
      process.env['NODE_ENV'] === 'production' ? '/app/data/backups' : join(tmpdir(), 'fleet-backups')
    );
    try {
      await access(backupDir);
    } catch {
      await mkdir(backupDir, { recursive: true });
    }
  } catch (err) {
    issues.push(`Backup directory not writable: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (issues.length > 0) {
    logger.warn(
      { issues, count: issues.length },
      `Upgrade system self-test: ${issues.length} issue(s) detected`,
    );
  } else {
    logger.info('Upgrade system self-test: all checks passed');
  }
}
