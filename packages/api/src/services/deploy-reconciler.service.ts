/**
 * Deploy Reconciler Service
 *
 * Merges user-configured volumes/env/ports with what compose files and
 * Dockerfiles define. This is the heart of the PaaS — it understands
 * what both the project and the user want, then wires them together.
 *
 * Key principles:
 *   1. Mount path (target) is the anchor for volume matching
 *   2. User config always wins on conflicts
 *   3. Compose/Dockerfile-only volumes get auto-created as Fleet storage volumes
 *   4. Env vars are merged (user overrides compose/Dockerfile defaults)
 *   5. Ports are merged by target port
 *   6. Quota-aware: auto-created volumes share remaining space evenly
 */

import { db, storageVolumes, eq, and } from '@fleet/db';
import { storageManager } from './storage/storage-manager.js';
import { logger } from './logger.js';
import type { ComposeServiceConfig } from './build.service.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface VolumeMount {
  source: string;
  target: string;
  readonly: boolean;
}

export interface PortMapping {
  target: number;
  published: number;
  protocol: string;
}

export interface ReconcileInput {
  serviceId: string;
  accountId: string;
  serviceName: string;

  /** User-configured volumes from the DB service record */
  userVolumes: VolumeMount[];
  /** User-configured env vars from the DB service record */
  userEnv: Record<string, string>;
  /** User-configured ports from the DB service record */
  userPorts: PortMapping[];

  /** Compose-derived config (from build pipeline) */
  composeConfig?: ComposeServiceConfig | null;
  /** Dockerfile content (stored on service or auto-generated) */
  dockerfile?: string | null;
}

export interface ReconcileResult {
  volumes: VolumeMount[];
  env: Record<string, string>;
  ports: PortMapping[];
  /** Volumes that were auto-created during reconciliation */
  createdVolumes: string[];
  /** Human-readable log of what was reconciled */
  log: string[];
}

/** Exported for frontend volume analysis (pre-deploy validation) */
export interface VolumeAnalysis {
  /** Volumes the user already configured (with Fleet sources) */
  userVolumes: VolumeMount[];
  /** Volumes defined in compose/Dockerfile that need Fleet volumes */
  uncoveredVolumes: Array<{ target: string; composeSource: string | null; suggestedSizeGb: number }>;
  /** Remaining quota in GB after accounting for user volumes */
  remainingQuotaGb: number;
  /** Total quota limit */
  quotaLimitGb: number;
  /** Current usage */
  quotaUsedGb: number;
  /** Whether all uncovered volumes can fit within quota */
  canFitAll: boolean;
}

// ── Dockerfile parsing ─────────────────────────────────────────────────────

interface DockerfileHints {
  exposePorts: number[];
  volumes: string[];
  env: Record<string, string>;
}

export function parseDockerfileHints(dockerfile: string): DockerfileHints {
  const hints: DockerfileHints = { exposePorts: [], volumes: [], env: {} };

  for (const line of dockerfile.split('\n')) {
    const trimmed = line.trim();

    // EXPOSE 80 443 8080/tcp
    if (/^EXPOSE\s/i.test(trimmed)) {
      const parts = trimmed.slice(7).trim().split(/\s+/);
      for (const p of parts) {
        const port = parseInt(p.replace(/\/.*$/, ''), 10);
        if (port > 0 && port <= 65535) hints.exposePorts.push(port);
      }
    }

    // VOLUME ["/data"] or VOLUME /data /logs
    if (/^VOLUME\s/i.test(trimmed)) {
      const rest = trimmed.slice(7).trim();
      if (rest.startsWith('[')) {
        try {
          const parsed = JSON.parse(rest) as string[];
          hints.volumes.push(...parsed);
        } catch {
          hints.volumes.push(...rest.replace(/[\[\]"',]/g, '').split(/\s+/).filter(Boolean));
        }
      } else {
        hints.volumes.push(...rest.split(/\s+/).filter(Boolean));
      }
    }

    // ENV KEY=value or ENV KEY value
    if (/^ENV\s/i.test(trimmed)) {
      const rest = trimmed.slice(4).trim();
      const eqIdx = rest.indexOf('=');
      if (eqIdx > 0) {
        const pairs = rest.match(/(\w+)=("[^"]*"|'[^']*'|\S+)/g);
        if (pairs) {
          for (const pair of pairs) {
            const [k, ...vParts] = pair.split('=');
            const v = vParts.join('=').replace(/^["']|["']$/g, '');
            if (k) hints.env[k] = v;
          }
        }
      } else {
        const spaceIdx = rest.indexOf(' ');
        if (spaceIdx > 0) {
          hints.env[rest.slice(0, spaceIdx)] = rest.slice(spaceIdx + 1).trim();
        }
      }
    }
  }

  return hints;
}

// ── Volume analysis (for pre-deploy validation) ────────────────────────────

/**
 * Analyze what volumes a deployment needs without creating anything.
 * Used by the frontend to show the volume configurator before deploy.
 */
export async function analyzeVolumes(input: {
  accountId: string;
  userVolumes: VolumeMount[];
  composeConfig?: ComposeServiceConfig | null;
  dockerfile?: string | null;
}): Promise<VolumeAnalysis> {
  const dockerHints = input.dockerfile ? parseDockerfileHints(input.dockerfile) : null;

  // What the user already covers
  const coveredTargets = new Set(input.userVolumes.map(v => v.target));

  // Collect uncovered volumes from compose + Dockerfile
  const uncovered: VolumeAnalysis['uncoveredVolumes'] = [];

  for (const cv of input.composeConfig?.volumes ?? []) {
    if (!coveredTargets.has(cv.target)) {
      coveredTargets.add(cv.target); // prevent duplicates
      uncovered.push({ target: cv.target, composeSource: cv.source, suggestedSizeGb: 5 });
    }
  }

  for (const dv of dockerHints?.volumes ?? []) {
    if (!coveredTargets.has(dv)) {
      coveredTargets.add(dv);
      uncovered.push({ target: dv, composeSource: null, suggestedSizeGb: 5 });
    }
  }

  // Fetch quota
  const [usedGb, limitGb] = await Promise.all([
    storageManager.getAccountStorageUsage(input.accountId),
    storageManager.getAccountStorageLimit(input.accountId),
  ]);
  const remainingGb = Math.max(0, limitGb - usedGb);

  // Distribute remaining space evenly across uncovered volumes
  if (uncovered.length > 0) {
    const perVolume = Math.floor(remainingGb / uncovered.length);
    const sizeEach = Math.max(1, Math.min(perVolume, 5)); // 1-5 GB default, capped at fair share
    for (const u of uncovered) {
      u.suggestedSizeGb = sizeEach;
    }
  }

  const totalNeeded = uncovered.reduce((s, u) => s + u.suggestedSizeGb, 0);

  return {
    userVolumes: input.userVolumes,
    uncoveredVolumes: uncovered,
    remainingQuotaGb: remainingGb,
    quotaLimitGb: limitGb,
    quotaUsedGb: usedGb,
    canFitAll: totalNeeded <= remainingGb,
  };
}

// ── Reconciler ─────────────────────────────────────────────────────────────

export async function reconcileDeployConfig(input: ReconcileInput): Promise<ReconcileResult> {
  const log: string[] = [];
  const createdVolumes: string[] = [];

  const dockerHints = input.dockerfile ? parseDockerfileHints(input.dockerfile) : null;

  // ── Reconcile volumes (quota-aware) ────────────────────────────────────

  const userByTarget = new Map<string, VolumeMount>();
  for (const v of input.userVolumes) {
    userByTarget.set(v.target, v);
  }

  const composeVolumes: VolumeMount[] = input.composeConfig?.volumes ?? [];
  const dockerfileVolumes: string[] = dockerHints?.volumes ?? [];

  const finalVolumes = new Map<string, VolumeMount>();

  // 1. User volumes always go in first
  for (const v of input.userVolumes) {
    finalVolumes.set(v.target, v);
  }

  // 2. Collect all volumes that need auto-creation (compose + Dockerfile)
  const pendingAutoCreate: Array<{ target: string; composeSource: string | null; readonly: boolean }> = [];

  for (const cv of composeVolumes) {
    if (finalVolumes.has(cv.target)) {
      log.push(`Volume mount ${cv.target}: using user-configured source "${finalVolumes.get(cv.target)!.source}" (overrides compose source "${cv.source}")`);
      continue;
    }
    pendingAutoCreate.push({ target: cv.target, composeSource: cv.source, readonly: cv.readonly });
  }

  for (const dv of dockerfileVolumes) {
    if (finalVolumes.has(dv) || pendingAutoCreate.some(p => p.target === dv)) {
      if (finalVolumes.has(dv)) {
        log.push(`Dockerfile VOLUME ${dv}: already covered by ${finalVolumes.get(dv)!.source}`);
      }
      continue;
    }
    pendingAutoCreate.push({ target: dv, composeSource: null, readonly: false });
  }

  // 3. Quota-aware auto-creation: distribute remaining space evenly
  if (pendingAutoCreate.length > 0) {
    let remainingGb: number;
    try {
      const [usedGb, limitGb] = await Promise.all([
        storageManager.getAccountStorageUsage(input.accountId),
        storageManager.getAccountStorageLimit(input.accountId),
      ]);
      remainingGb = Math.max(0, limitGb - usedGb);
    } catch {
      remainingGb = 100; // fallback if quota check fails
    }

    // Share remaining space: min 1 GB, max 5 GB each, capped at fair share
    const perVolume = pendingAutoCreate.length > 0
      ? Math.floor(remainingGb / pendingAutoCreate.length)
      : 0;
    const sizeEach = Math.max(1, Math.min(perVolume, 5));

    if (remainingGb < pendingAutoCreate.length) {
      log.push(`WARNING: Only ${remainingGb} GB remaining — not enough for ${pendingAutoCreate.length} volume(s). Some volumes may fail to create.`);
    } else {
      log.push(`Auto-creating ${pendingAutoCreate.length} volume(s) at ${sizeEach} GB each (${remainingGb} GB available)`);
    }

    for (const pending of pendingAutoCreate) {
      const autoSource = await autoCreateVolume(
        input.accountId,
        input.serviceName,
        pending.target,
        pending.composeSource,
        sizeEach,
      );
      if (autoSource) {
        finalVolumes.set(pending.target, { source: autoSource, target: pending.target, readonly: pending.readonly });
        createdVolumes.push(autoSource);
        log.push(`Volume mount ${pending.target}: auto-created "${autoSource}" (${sizeEach} GB)`);
      } else {
        // Use compose source as-is if auto-create failed
        if (pending.composeSource) {
          finalVolumes.set(pending.target, { source: pending.composeSource, target: pending.target, readonly: pending.readonly });
          log.push(`Volume mount ${pending.target}: using compose source "${pending.composeSource}" as-is (auto-create failed)`);
        }
      }
    }
  }

  // ── Reconcile env vars ─────────────────────────────────────────────────

  const finalEnv: Record<string, string> = {};

  if (dockerHints?.env) {
    Object.assign(finalEnv, dockerHints.env);
  }

  if (input.composeConfig?.env) {
    Object.assign(finalEnv, input.composeConfig.env);
  }

  Object.assign(finalEnv, input.userEnv);

  if (Object.keys(finalEnv).length > Object.keys(input.userEnv).length) {
    const added = Object.keys(finalEnv).filter(k => !(k in input.userEnv));
    if (added.length > 0) {
      log.push(`Env: merged ${added.length} variable(s) from compose/Dockerfile: ${added.join(', ')}`);
    }
  }

  // ── Reconcile ports ────────────────────────────────────────────────────

  const portByTarget = new Map<number, PortMapping>();

  for (const p of input.userPorts) {
    portByTarget.set(p.target, p);
  }

  if (input.composeConfig?.ports) {
    for (const cp of input.composeConfig.ports) {
      if (!portByTarget.has(cp.target)) {
        portByTarget.set(cp.target, cp);
        log.push(`Port ${cp.target}: added from compose (published: ${cp.published})`);
      }
    }
  }

  if (dockerHints?.exposePorts) {
    for (const ep of dockerHints.exposePorts) {
      if (!portByTarget.has(ep)) {
        portByTarget.set(ep, { target: ep, published: ep, protocol: 'tcp' });
        log.push(`Port ${ep}: added from Dockerfile EXPOSE`);
      }
    }
  }

  return {
    volumes: Array.from(finalVolumes.values()),
    env: finalEnv,
    ports: Array.from(portByTarget.values()),
    createdVolumes,
    log,
  };
}

// ── Auto-create Fleet storage volume ───────────────────────────────────────

async function autoCreateVolume(
  accountId: string,
  serviceName: string,
  mountTarget: string,
  composeSource: string | null,
  sizeGb: number,
): Promise<string | null> {
  try {
    const baseName = composeSource
      ? composeSource.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase()
      : mountTarget.replace(/^\//, '').replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase();

    const displayName = `${serviceName}-${baseName}`.slice(0, 60);
    const volumeName = `vol-${accountId}-${displayName}`;

    // Check if volume already exists
    const existing = await db.query.storageVolumes.findFirst({
      where: and(
        eq(storageVolumes.accountId, accountId),
        eq(storageVolumes.name, volumeName),
      ),
    });

    if (existing) {
      logger.info({ volumeName }, 'Reconciler: reusing existing volume');
      return volumeName;
    }

    // skipQuotaCheck: we already calculated per-volume sizing above
    await storageManager.createVolume(accountId, volumeName, displayName, sizeGb, undefined, null, { skipQuotaCheck: true });
    logger.info({ volumeName, mountTarget, sizeGb, accountId }, 'Reconciler: auto-created volume');
    return volumeName;
  } catch (err) {
    logger.error({ err, accountId, mountTarget }, 'Reconciler: failed to auto-create volume');
    return null;
  }
}
