import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { db, services, deployments, oauthProviders, userAccounts, users, eq, and, isNull, inArray } from '@fleet/db';
import { buildService, scrubSecrets } from '../services/build.service.js';
import { orchestrator } from '../services/orchestrator.js';
import { getRegistryAuthForImage } from '../services/docker.service.js';
import { githubService } from '../services/github.service.js';
import { getValkey } from '../services/valkey.service.js';
import { decrypt } from '../services/crypto.service.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { emailService } from '../services/email.service.js';
import { getEmailQueue, isQueueAvailable } from '../services/queue.service.js';
import type { EmailJobData } from './email.worker.js';

async function queueEmail(data: EmailJobData): Promise<void> {
  if (isQueueAvailable()) {
    await getEmailQueue().add('send-email', data);
  } else {
    emailService.sendTemplateEmail(data.templateSlug, data.to, data.variables, data.accountId)
      .catch((err) => logger.error({ err }, `Failed to send ${data.templateSlug} email`));
  }
}

async function notifyAccountMembers(accountId: string, templateSlug: string, variables: Record<string, string>): Promise<void> {
  try {
    const members = await db.query.userAccounts.findMany({
      where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
      with: { user: true },
    });
    for (const m of members) {
      if (m.user?.email) {
        queueEmail({
          templateSlug,
          to: m.user.email,
          variables,
          accountId,
        }).catch((err) => logger.error({ err }, `Failed to queue ${templateSlug} email`));
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to notify account members');
  }
}

export interface DeploymentJobData {
  deploymentId: string;
  serviceId: string;
  accountId: string;
  commitSha: string | null;
  sourceType?: 'github' | 'upload';
  sourcePath?: string;
  buildMethod?: 'dockerfile' | 'compose' | 'none';
  buildFile?: string;
}

async function getGitHubTokenForService(accountId: string): Promise<string | null> {
  // Find a GitHub OAuth token from a user who is a member of this account
  const accountMembers = await db.query.userAccounts.findMany({
    where: eq(userAccounts.accountId, accountId),
    columns: { userId: true },
  });

  if (accountMembers.length === 0) return null;

  const memberUserIds = accountMembers.map((m) => m.userId);

  const result = await db.query.oauthProviders.findFirst({
    where: and(
      eq(oauthProviders.provider, 'github'),
      inArray(oauthProviders.userId, memberUserIds),
    ),
  });

  if (!result?.accessToken) return null;

  return decrypt(result.accessToken);
}

type ProgressStep = 'queued' | 'cloning' | 'building' | 'pushing' | 'deploying' | 'health_check' | 'succeeded' | 'failed';

// Cached Valkey client — resolved once, reused for all publishes.
// Re-resolves if connection drops (TTL-based refresh every 60s).
let cachedValkey: Awaited<ReturnType<typeof getValkey>> = undefined as any;
let valkeyResolvedAt = 0;
const VALKEY_CACHE_TTL_MS = 60_000;

async function getValkeyClient() {
  const now = Date.now();
  if (cachedValkey !== undefined && (now - valkeyResolvedAt) < VALKEY_CACHE_TTL_MS) return cachedValkey;
  cachedValkey = await getValkey();
  valkeyResolvedAt = now;
  return cachedValkey;
}

async function publishProgress(deploymentId: string, status: string, log: string, step?: ProgressStep, logLine?: string) {
  const valkey = await getValkeyClient();
  if (valkey) {
    valkey.publish(`deploy:${deploymentId}`, JSON.stringify({ status, step, logLine })).catch((err) => {
      logger.error({ err, deploymentId }, 'Failed to publish deployment progress');
    });
  }
}

async function setProgressStep(deploymentId: string, step: ProgressStep) {
  await db.update(deployments)
    .set({ progressStep: step })
    .where(eq(deployments.id, deploymentId));
  await publishProgress(deploymentId, step === 'succeeded' ? 'succeeded' : step === 'failed' ? 'failed' : 'building', '', step);
}

async function processDeployment(job: Job<DeploymentJobData>): Promise<void> {
  const { deploymentId, serviceId, accountId, commitSha, sourceType, sourcePath, buildMethod, buildFile } = job.data;

  try {
  // Idempotency guard: if deployment is already terminal (succeeded/failed), skip
  const existing = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    columns: { status: true },
  });
  if (existing && (existing.status === 'succeeded' || existing.status === 'failed')) {
    logger.warn({ deploymentId, status: existing.status }, 'Skipping already-completed deployment (idempotency guard)');
    return;
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    await db.update(deployments)
      .set({ status: 'failed', log: 'Service not found' })
      .where(eq(deployments.id, deploymentId));
    return;
  }

  const imageTag = `${accountId}-${svc.name}:${commitSha?.slice(0, 7) ?? Date.now()}`.toLowerCase();

  // Track deployment start time
  await db.update(deployments)
    .set({ startedAt: new Date(), progressStep: 'queued' })
    .where(eq(deployments.id, deploymentId));

  let buildInfo: { id: string; status: string; log: string; imageTag: string; finishedAt: Date | null } | undefined;

  try {
    if (sourceType === 'upload' && sourcePath) {
      if (buildMethod === 'none') {
        // No build file — upload complete, service stays stopped until user adds one
        await db.update(deployments)
          .set({ status: 'succeeded', log: 'Upload complete. No Dockerfile or compose file detected — add one via the Files tab and rebuild.' })
          .where(eq(deployments.id, deploymentId));

        await db.update(services)
          .set({ status: 'stopped', updatedAt: new Date() })
          .where(eq(services.id, svc.id));

        await publishProgress(deploymentId, 'succeeded', 'No build file found');
        return;
      }

      await setProgressStep(deploymentId, 'building');

      if (buildMethod === 'compose') {
        buildInfo = await buildService.buildFromCompose({
          serviceId: svc.id,
          sourceDir: sourcePath,
          composeFile: buildFile,
          imageTag,
        });
      } else {
        buildInfo = await buildService.buildFromDirectory({
          serviceId: svc.id,
          sourceDir: sourcePath,
          dockerfile: buildFile,
          imageTag,
        });
      }
    } else {
      // GitHub build flow
      await setProgressStep(deploymentId, 'cloning');
      if (!svc.githubRepo || !svc.githubBranch) {
        await db.update(deployments)
          .set({ status: 'failed', log: 'Service has no GitHub repository configured' })
          .where(eq(deployments.id, deploymentId));
        return;
      }

      const [owner, repo] = svc.githubRepo.split('/');
      if (!owner || !repo) {
        await db.update(deployments)
          .set({ status: 'failed', log: `Invalid GitHub repo format: ${svc.githubRepo}` })
          .where(eq(deployments.id, deploymentId));
        return;
      }

      const githubToken = await getGitHubTokenForService(accountId);
      const cloneUrl = githubToken
        ? githubService.getAuthenticatedCloneUrl(githubToken, owner, repo)
        : `https://github.com/${svc.githubRepo}.git`;

      // Detect Dockerfiles and project files for runtime detection
      let generatedDockerfile: string | undefined;
      let dockerfile: string | undefined;
      try {
        const detection = await buildService.detectDockerfile(cloneUrl, svc.githubBranch);
        if (detection.dockerfiles.length > 0) {
          dockerfile = detection.dockerfiles[0];
        } else {
          // No Dockerfile found — try runtime detection
          const { detectRuntime } = await import('../services/runtime.service.js');
          const runtimeResult = await detectRuntime(detection.allFiles, null);
          if (runtimeResult) {
            generatedDockerfile = runtimeResult.dockerfile;
            // Store the generated Dockerfile on the service record
            await db.update(services)
              .set({ dockerfile: runtimeResult.dockerfile })
              .where(eq(services.id, svc.id));
            logger.info({ serviceId: svc.id, runtime: runtimeResult.runtime }, 'Auto-detected runtime for GitHub deploy');
          }
        }
      } catch (err) {
        logger.warn({ err, serviceId: svc.id }, 'Failed to detect Dockerfiles — will try default Dockerfile');
      }

      await setProgressStep(deploymentId, 'building');
      buildInfo = await buildService.buildImage({
        serviceId: svc.id,
        cloneUrl,
        branch: svc.githubBranch,
        dockerfile,
        imageTag,
        generatedDockerfile,
      });
    }

    if (!buildInfo) {
      throw new Error('No build info — buildMethod may be unsupported');
    }
    const build = buildInfo;

    // Wait for build to complete (30-minute timeout to prevent indefinite hangs)
    const BUILD_TIMEOUT_MS = 30 * 60 * 1000;
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        let lastDbWrite = 0;
        let dbWriteTimer: ReturnType<typeof setTimeout> | null = null;
        let lastLogLength = 0;
        const DB_WRITE_INTERVAL_MS = 3000;

        let lastFlushedLogLength = 0;

        const flushToDb = (info: { log: string; status: string }) => {
          // Skip write if log hasn't changed (avoids redundant DB pressure)
          if (info.log.length === lastFlushedLogLength && info.status !== 'succeeded' && info.status !== 'failed') return;
          lastFlushedLogLength = info.log.length;

          const dbStatus = info.status === 'succeeded' ? 'deploying'
            : info.status === 'failed' ? 'failed'
            : 'building';
          db.update(deployments)
            .set({ log: info.log, status: dbStatus })
            .where(eq(deployments.id, deploymentId))
            .catch((err) => {
              logger.error({ err, deploymentId }, 'Failed to update deployment log in DB');
            });
          lastDbWrite = Date.now();
        };

        const unsubscribe = buildService.onBuildUpdate(build.id, (info) => {
          // Extract new log content since last publish
          const newContent = info.log.slice(lastLogLength);
          lastLogLength = info.log.length;

          // Publish incremental line to Valkey immediately (for real-time WS streaming)
          publishProgress(deploymentId, info.status, '', undefined, newContent || undefined);

          // Throttle DB writes to every 3 seconds
          const now = Date.now();
          if (info.status === 'succeeded' || info.status === 'failed' || info.status === 'cancelled') {
            // Always flush on terminal status
            if (dbWriteTimer) { clearTimeout(dbWriteTimer); dbWriteTimer = null; }
            flushToDb(info);
          } else if (now - lastDbWrite >= DB_WRITE_INTERVAL_MS) {
            flushToDb(info);
          } else if (!dbWriteTimer) {
            dbWriteTimer = setTimeout(() => {
              dbWriteTimer = null;
              flushToDb(info);
            }, DB_WRITE_INTERVAL_MS - (now - lastDbWrite));
          }

          if (info.status === 'succeeded') {
            unsubscribe();
            resolve();
          } else if (info.status === 'failed' || info.status === 'cancelled') {
            unsubscribe();
            // Include log excerpt in rejection so the catch block has context
            const lastErrors = info.log.split('\n').filter(l => l.includes('[error]')).slice(-2).join('\n');
            reject(new Error(`Build ${info.status}${lastErrors ? ': ' + lastErrors : ''}`));
          }
        });

        // Race condition guard: the build pipeline runs async and may complete
        // before the listener above is registered (especially for fast builds like
        // cached nginx). Check buildInfo status immediately after listener setup.
        if (build.status === 'succeeded') {
          unsubscribe();
          flushToDb(build);
          resolve();
        } else if (build.status === 'failed' || build.status === 'cancelled') {
          unsubscribe();
          flushToDb(build);
          const lastErrors = build.log.split('\n').filter(l => l.includes('[error]')).slice(-2).join('\n');
          reject(new Error(`Build ${build.status}${lastErrors ? ': ' + lastErrors : ''}`));
        }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Build timed out after ${BUILD_TIMEOUT_MS / 60000} minutes`)), BUILD_TIMEOUT_MS),
      ),
    ]);

    // Deploy the newly built image
    const fullImageTag = build.imageTag;

    // Persist final build log (handles cases where intermediate DB writes were missed)
    if (build.log) {
      await db.update(deployments)
        .set({ log: build.log })
        .where(eq(deployments.id, deploymentId));
    }

    await setProgressStep(deploymentId, 'deploying');
    await db.update(deployments)
      .set({ status: 'deploying', imageTag: fullImageTag })
      .where(eq(deployments.id, deploymentId));

    if (svc.dockerServiceId) {
      // Clean up old failed/dead containers before deploying new version
      try {
        const pruned = await orchestrator.pruneServiceContainers(svc.dockerServiceId);
        if (pruned > 0) {
          logger.info({ serviceId: svc.id, pruned }, 'Pruned dead containers before deploy');
        }
      } catch (err) {
        logger.warn({ err, serviceId: svc.id }, 'Failed to prune old containers before deploy');
      }

      const deployRegistryAuth = await getRegistryAuthForImage(accountId, fullImageTag);
      await orchestrator.updateService(svc.dockerServiceId, {
        image: fullImageTag,
        replicas: svc.replicas ?? 1,
      }, deployRegistryAuth);
    } else {
      logger.warn({ serviceId: svc.id }, 'No dockerServiceId — image built but cannot deploy to Docker');
    }

    // Mark as succeeded
    await db.update(deployments)
      .set({ status: 'succeeded', commitSha, progressStep: 'succeeded', completedAt: new Date() })
      .where(eq(deployments.id, deploymentId));

    await db.update(services)
      .set({ image: fullImageTag, status: svc.dockerServiceId ? 'running' : 'stopped', updatedAt: new Date() })
      .where(eq(services.id, svc.id));

    await publishProgress(deploymentId, 'succeeded', '', 'succeeded');

    // Notify account owners
    notifyAccountMembers(accountId, 'deploy-success', {
      serviceName: svc.name,
      imageTag: fullImageTag,
    });
  } catch (err) {
    // Scrub error messages to prevent token leakage (e.g. git clone URLs with OAuth tokens)
    const safeError = scrubSecrets(String(err));

    // Preserve build log from buildInfo if available
    // The build log already contains [error] lines from the build pipeline —
    // only append the wrapper error if the log is empty (no build output captured)
    const existingLog = (buildInfo?.log ?? '').trim();
    const hasErrorLines = existingLog.includes('[error]');
    const failLog = existingLog
      ? hasErrorLines
        ? existingLog  // Log already has detailed error context
        : `${existingLog}\n\n[error] Build/deploy failed: ${safeError}`
      : `Build/deploy failed: ${safeError}`;

    await db.update(deployments)
      .set({ status: 'failed', log: failLog, progressStep: 'failed', completedAt: new Date() })
      .where(eq(deployments.id, deploymentId));

    await db.update(services)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(services.id, svc.id));

    await publishProgress(deploymentId, 'failed', safeError, 'failed');

    // Notify account owners of failure
    notifyAccountMembers(accountId, 'deploy-failed', {
      serviceName: svc.name,
      errorMessage: safeError,
    });

    throw err;
  }
  } catch (outerErr) {
    // Catch-all: ensure deployment is NEVER left stuck at "building" on unexpected errors
    // (e.g. DB connection failure during setup, import errors, etc.)
    logger.error({ err: outerErr, deploymentId }, 'Deployment failed with unhandled error');
    logToErrorTable({
      level: 'error',
      message: `Deployment ${deploymentId} failed: ${String(outerErr)}`,
      stack: outerErr instanceof Error ? outerErr.stack : undefined,
      metadata: { deploymentId, worker: 'deployment' },
    });
    try {
      const current = await db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
        columns: { status: true },
      });
      // Only update if still in a non-terminal state
      if (current && current.status !== 'succeeded' && current.status !== 'failed') {
        const safeMsg = scrubSecrets(String(outerErr));
        await db.update(deployments)
          .set({ status: 'failed', log: `Deployment failed: ${safeMsg}`, progressStep: 'failed', completedAt: new Date() })
          .where(eq(deployments.id, deploymentId));
        await publishProgress(deploymentId, 'failed', safeMsg, 'failed');
      }
    } catch (dbErr) {
      logger.error({ err: dbErr, deploymentId }, 'Failed to mark deployment as failed in catch-all');
    }
    throw outerErr;
  }
}

/**
 * Run the deployment processor directly (for local dev fallback without BullMQ).
 */
export async function processDeploymentInline(data: DeploymentJobData): Promise<void> {
  await processDeployment({ data } as Job<DeploymentJobData>);
}

export function createDeploymentWorker(connection: ConnectionOptions): Worker {
  return new Worker<DeploymentJobData>('fleet-deployment', processDeployment, {
    connection,
    concurrency: 10,
  });
}
