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

// ── Dockerfile parsing ─────────────────────────────────────────────────────

interface DockerfileHints {
  exposePorts: number[];
  volumes: string[];
  env: Record<string, string>;
}

function parseDockerfileHints(dockerfile: string): DockerfileHints {
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
          // Fall back to splitting
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
        // ENV KEY=value KEY2=value2
        const pairs = rest.match(/(\w+)=("[^"]*"|'[^']*'|\S+)/g);
        if (pairs) {
          for (const pair of pairs) {
            const [k, ...vParts] = pair.split('=');
            const v = vParts.join('=').replace(/^["']|["']$/g, '');
            if (k) hints.env[k] = v;
          }
        }
      } else {
        // Legacy: ENV KEY value
        const spaceIdx = rest.indexOf(' ');
        if (spaceIdx > 0) {
          hints.env[rest.slice(0, spaceIdx)] = rest.slice(spaceIdx + 1).trim();
        }
      }
    }
  }

  return hints;
}

// ── Reconciler ─────────────────────────────────────────────────────────────

export async function reconcileDeployConfig(input: ReconcileInput): Promise<ReconcileResult> {
  const log: string[] = [];
  const createdVolumes: string[] = [];

  // Parse Dockerfile hints
  const dockerHints = input.dockerfile ? parseDockerfileHints(input.dockerfile) : null;

  // ── Reconcile volumes ──────────────────────────────────────────────────

  // Build a map of user volumes by mount target
  const userByTarget = new Map<string, VolumeMount>();
  for (const v of input.userVolumes) {
    userByTarget.set(v.target, v);
  }

  // Collect compose volumes
  const composeVolumes: VolumeMount[] = input.composeConfig?.volumes ?? [];
  // Collect Dockerfile VOLUME directives
  const dockerfileVolumes: string[] = dockerHints?.volumes ?? [];

  // Merge: user config wins, compose fills gaps, Dockerfile fills remaining gaps
  const finalVolumes = new Map<string, VolumeMount>();

  // 1. User volumes always go in first
  for (const v of input.userVolumes) {
    finalVolumes.set(v.target, v);
  }

  // 2. Compose volumes — only add if target not already covered by user
  for (const cv of composeVolumes) {
    if (finalVolumes.has(cv.target)) {
      log.push(`Volume mount ${cv.target}: using user-configured source "${finalVolumes.get(cv.target)!.source}" (overrides compose source "${cv.source}")`);
      continue;
    }
    // Auto-create a Fleet volume for this compose-defined mount
    const autoSource = await autoCreateVolume(input.accountId, input.serviceName, cv.target, cv.source);
    if (autoSource) {
      finalVolumes.set(cv.target, { source: autoSource, target: cv.target, readonly: cv.readonly });
      createdVolumes.push(autoSource);
      log.push(`Volume mount ${cv.target}: auto-created Fleet volume "${autoSource}" (from compose source "${cv.source}")`);
    } else {
      // Couldn't auto-create — use compose source as-is (named volume)
      finalVolumes.set(cv.target, cv);
      log.push(`Volume mount ${cv.target}: using compose source "${cv.source}" as-is`);
    }
  }

  // 3. Dockerfile VOLUME directives — only add if target not already covered
  for (const dv of dockerfileVolumes) {
    if (finalVolumes.has(dv)) {
      log.push(`Dockerfile VOLUME ${dv}: already covered by ${finalVolumes.get(dv)!.source}`);
      continue;
    }
    const autoSource = await autoCreateVolume(input.accountId, input.serviceName, dv, null);
    if (autoSource) {
      finalVolumes.set(dv, { source: autoSource, target: dv, readonly: false });
      createdVolumes.push(autoSource);
      log.push(`Dockerfile VOLUME ${dv}: auto-created Fleet volume "${autoSource}"`);
    }
  }

  // ── Reconcile env vars ─────────────────────────────────────────────────

  const finalEnv: Record<string, string> = {};

  // Dockerfile ENV as base defaults
  if (dockerHints?.env) {
    Object.assign(finalEnv, dockerHints.env);
  }

  // Compose env overlays Dockerfile defaults
  if (input.composeConfig?.env) {
    Object.assign(finalEnv, input.composeConfig.env);
  }

  // User env wins over everything
  Object.assign(finalEnv, input.userEnv);

  if (Object.keys(finalEnv).length > Object.keys(input.userEnv).length) {
    const added = Object.keys(finalEnv).filter(k => !(k in input.userEnv));
    if (added.length > 0) {
      log.push(`Env: merged ${added.length} variable(s) from compose/Dockerfile: ${added.join(', ')}`);
    }
  }

  // ── Reconcile ports ────────────────────────────────────────────────────

  const portByTarget = new Map<number, PortMapping>();

  // User ports first
  for (const p of input.userPorts) {
    portByTarget.set(p.target, p);
  }

  // Compose ports fill gaps
  if (input.composeConfig?.ports) {
    for (const cp of input.composeConfig.ports) {
      if (!portByTarget.has(cp.target)) {
        portByTarget.set(cp.target, cp);
        log.push(`Port ${cp.target}: added from compose (published: ${cp.published})`);
      }
    }
  }

  // Dockerfile EXPOSE fills remaining gaps
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

/**
 * Creates a Fleet storage volume for a compose/Dockerfile-defined mount point.
 * Uses a deterministic naming scheme: vol-<accountId>-<serviceName>-<sanitized-path>
 *
 * Returns the volume name if created (or already exists), null on failure.
 */
async function autoCreateVolume(
  accountId: string,
  serviceName: string,
  mountTarget: string,
  composeSource: string | null,
): Promise<string | null> {
  try {
    // Derive a clean name from the mount path or compose source
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

    // Create the volume (default 5 GB for auto-created volumes)
    await storageManager.createVolume(accountId, volumeName, displayName, 5, undefined, null);
    logger.info({ volumeName, mountTarget, accountId }, 'Reconciler: auto-created volume');
    return volumeName;
  } catch (err) {
    logger.error({ err, accountId, mountTarget }, 'Reconciler: failed to auto-create volume');
    return null;
  }
}
