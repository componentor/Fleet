import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { db, services, deployments, oauthProviders, userAccounts, users, insertReturning, eq, and, isNull, inArray } from '@fleet/db';
import { buildService, scrubSecrets } from '../services/build.service.js';
import { orchestrator } from '../services/orchestrator.js';
import { getRegistryAuthForImage } from '../services/docker.service.js';
import { buildTraefikLabels, ensureIngressRoute } from '../services/traefik.js';
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

async function publishProgress(deploymentId: string, status: string, log: string, step?: ProgressStep, logLine?: string, statusMessage?: string) {
  const valkey = await getValkeyClient();
  if (valkey) {
    valkey.publish(`deploy:${deploymentId}`, JSON.stringify({ status, step, logLine, statusMessage })).catch((err) => {
      logger.error({ err, deploymentId }, 'Failed to publish deployment progress');
    });
  }
}

async function setProgressStep(deploymentId: string, step: ProgressStep, statusMessage?: string) {
  await db.update(deployments)
    .set({ progressStep: step })
    .where(eq(deployments.id, deploymentId));

  const deployPhaseSteps: ProgressStep[] = ['deploying', 'health_check', 'succeeded', 'failed'];
  const dbStatus = step === 'succeeded' ? 'succeeded'
    : step === 'failed' ? 'failed'
    : deployPhaseSteps.includes(step) ? 'deploying'
    : 'building';
  await publishProgress(deploymentId, dbStatus, '', step, undefined, statusMessage);
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

  // Notify any open service-events WebSocket clients that a new deployment started
  const valkey = await getValkeyClient();
  if (valkey) {
    valkey.publish(`service:${serviceId}`, JSON.stringify({
      type: 'deployment_started',
      deploymentId,
      serviceId,
    })).catch(() => {});
  }

  let buildInfo: { id: string; status: string; log: string; imageTag: string; finishedAt: Date | null; composeServices?: import('../services/build.service.js').ComposeServiceConfig[] } | undefined;

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

      await setProgressStep(deploymentId, 'building', buildMethod === 'compose' ? 'Building services from compose file...' : 'Building image from Dockerfile...');

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
    } else if (svc.gitUrl) {
      // Generic Git build flow (GitLab, Bitbucket, Gitea, self-hosted, etc.)
      await setProgressStep(deploymentId, 'cloning', `Cloning ${svc.gitBranch || 'main'} branch...`);
      const branch = svc.gitBranch || 'main';

      // Build clone URL with optional token auth
      let cloneUrl = svc.gitUrl;
      if (svc.gitToken) {
        try {
          const url = new URL(svc.gitUrl);
          url.username = 'oauth2';
          url.password = svc.gitToken;
          cloneUrl = url.toString();
        } catch {
          // Not a valid URL for token injection — use as-is
        }
      }

      let generatedDockerfile: string | undefined;
      let dockerfile: string | undefined;
      let composeFile: string | undefined;
      try {
        const detection = await buildService.detectDockerfile(cloneUrl, branch);
        if (detection.dockerfiles.length > 0) {
          dockerfile = detection.dockerfiles[0];
        } else if (detection.composeFiles.length > 0) {
          composeFile = detection.composeFiles[0];
        } else {
          const { detectRuntime } = await import('../services/runtime.service.js');
          const runtimeResult = await detectRuntime(detection.allFiles, null, svc.nginxConfig);
          if (runtimeResult) {
            generatedDockerfile = runtimeResult.dockerfile;
            await db.update(services)
              .set({ dockerfile: runtimeResult.dockerfile })
              .where(eq(services.id, svc.id));
            logger.info({ serviceId: svc.id, runtime: runtimeResult.runtime }, 'Auto-detected runtime for Git deploy');
          }
        }
      } catch (err) {
        logger.warn({ err, serviceId: svc.id }, 'Failed to detect Dockerfiles — will try default Dockerfile');
      }

      if (composeFile) {
        await setProgressStep(deploymentId, 'building', `Building services from ${composeFile}...`);
        buildInfo = await buildService.buildFromComposeGit({
          serviceId: svc.id,
          cloneUrl,
          branch,
          composeFile,
          imageTag,
        });
      } else {
        await setProgressStep(deploymentId, 'building', dockerfile ? `Building with ${dockerfile}...` : 'Building image (auto-detected runtime)...');
        buildInfo = await buildService.buildImage({
          serviceId: svc.id,
          cloneUrl,
          branch,
          dockerfile,
          imageTag,
          generatedDockerfile,
        });
      }
    } else {
      // GitHub build flow
      await setProgressStep(deploymentId, 'cloning', `Cloning ${svc.githubRepo} (${svc.githubBranch})...`);
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

      // Detect Dockerfiles, compose files, and project files for runtime detection
      let generatedDockerfile: string | undefined;
      let dockerfile: string | undefined;
      let composeFile: string | undefined;
      try {
        const detection = await buildService.detectDockerfile(cloneUrl, svc.githubBranch);
        if (detection.dockerfiles.length > 0) {
          dockerfile = detection.dockerfiles[0];
        } else if (detection.composeFiles.length > 0) {
          composeFile = detection.composeFiles[0];
        } else {
          // No Dockerfile or compose found — try runtime detection
          const { detectRuntime } = await import('../services/runtime.service.js');
          const runtimeResult = await detectRuntime(detection.allFiles, null, svc.nginxConfig);
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

      if (composeFile) {
        await setProgressStep(deploymentId, 'building', `Building services from ${composeFile}...`);
        buildInfo = await buildService.buildFromComposeGit({
          serviceId: svc.id,
          cloneUrl,
          branch: svc.githubBranch,
          composeFile,
          imageTag,
        });
      } else {
        await setProgressStep(deploymentId, 'building', dockerfile ? `Building with ${dockerfile}...` : 'Building image (auto-detected runtime)...');
        buildInfo = await buildService.buildImage({
          serviceId: svc.id,
          cloneUrl,
          branch: svc.githubBranch,
          dockerfile,
          imageTag,
          generatedDockerfile,
        });
      }
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

        let lastBuildStep = '';
        const unsubscribe = buildService.onBuildUpdate(build.id, (info) => {
          // Extract new log content since last publish
          const newContent = info.log.slice(lastLogLength);
          lastLogLength = info.log.length;

          // Map build service status to deployment progress steps
          // This ensures the frontend stepper advances in real-time
          if (info.status !== lastBuildStep) {
            lastBuildStep = info.status;
            if (info.status === 'pushing') {
              setProgressStep(deploymentId, 'pushing', 'Pushing image to registry...');
            } else if (info.status === 'cloning') {
              setProgressStep(deploymentId, 'cloning', 'Cloning repository...');
            }
          }

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

    // Deploy the newly built image(s)
    const fullImageTag = build.imageTag;

    // Persist final build log (handles cases where intermediate DB writes were missed)
    if (build.log) {
      await db.update(deployments)
        .set({ log: build.log })
        .where(eq(deployments.id, deploymentId));
    }

    await setProgressStep(deploymentId, 'deploying', 'Deploying to Docker Swarm...');
    await db.update(deployments)
      .set({ status: 'deploying', imageTag: fullImageTag })
      .where(eq(deployments.id, deploymentId));

    // Helper: deploy a single service to Docker Swarm (update existing or create new)
    async function deployOneService(
      targetSvc: NonNullable<typeof svc>,
      targetImageTag: string,
    ): Promise<void> {
      const networkName = `fleet-account-${accountId}`;
      const networkId = await orchestrator.ensureNetwork(networkName);
      const networkIds = [networkId];
      if (targetSvc.domain) {
        const publicNetId = await orchestrator.ensureNetwork('fleet_fleet_public');
        networkIds.push(publicNetId);
      }

      const svcPorts = (targetSvc.ports as any[]) ?? [];
      const primaryTargetPort = svcPorts[0]?.target ?? 80;
      const traefikLabels = buildTraefikLabels(targetSvc.name, targetSvc.domain ?? null, targetSvc.sslEnabled ?? true, primaryTargetPort, (targetSvc.robotsConfig as any)?.mode ?? 'default');
      const deployRegistryAuth = await getRegistryAuthForImage(accountId, targetImageTag);

      if (targetSvc.dockerServiceId) {
        // Update existing Docker service
        await publishProgress(deploymentId, 'deploying', '', 'deploying', undefined, `Updating service ${targetSvc.name}...`);
        try {
          const pruned = await orchestrator.pruneServiceContainers(targetSvc.dockerServiceId);
          if (pruned > 0) logger.info({ serviceId: targetSvc.id, pruned }, 'Pruned dead containers before deploy');
        } catch (err) {
          logger.warn({ err, serviceId: targetSvc.id }, 'Failed to prune old containers');
        }

        await orchestrator.updateService(targetSvc.dockerServiceId, {
          image: targetImageTag,
          replicas: targetSvc.replicas ?? 1,
          networkIds,
          volumes: ((targetSvc.volumes as any[]) ?? []).map((v: any) => ({
            source: v.source,
            target: v.target,
            readonly: v.readonly ?? false,
          })),
          labels: {
            ...traefikLabels,
            'fleet.account-id': accountId,
            'fleet.service-id': targetSvc.id,
          },
        }, deployRegistryAuth);
      } else {
        // Create new Docker service
        await publishProgress(deploymentId, 'deploying', '', 'deploying', undefined, `Creating service ${targetSvc.name}...`);
        logger.info({ serviceId: targetSvc.id }, 'Creating Docker service for deploy');

        const constraints = [...((targetSvc.placementConstraints as string[]) ?? [])];
        if (targetSvc.nodeConstraint) {
          constraints.push(`node.id == ${targetSvc.nodeConstraint}`);
        }

        const accountShort = accountId.replace(/-/g, '').substring(0, 12);
        const swarmServiceName = `fleet-${accountShort}-${targetSvc.name}`.toLowerCase();

        const ingressPorts = targetSvc.domain
          ? []
          : await orchestrator.allocateIngressPorts(
              svcPorts.map((p: any) => ({ target: p.target, protocol: p.protocol ?? 'tcp' })),
            );

        const result = await orchestrator.createService({
          name: swarmServiceName,
          image: targetImageTag,
          replicas: targetSvc.replicas ?? 1,
          env: (targetSvc.env as Record<string, string>) ?? {},
          ports: ingressPorts,
          volumes: ((targetSvc.volumes as any[]) ?? []).map((v: any) => ({
            source: v.source,
            target: v.target,
            readonly: v.readonly ?? false,
          })),
          labels: {
            ...traefikLabels,
            'fleet.account-id': accountId,
            'fleet.service-id': targetSvc.id,
          },
          constraints,
          healthCheck: (targetSvc.healthCheck as any) ?? undefined,
          updateParallelism: targetSvc.updateParallelism ?? 1,
          updateDelay: targetSvc.updateDelay ?? '10s',
          rollbackOnFailure: targetSvc.rollbackOnFailure ?? true,
          cpuLimit: targetSvc.cpuLimit ?? undefined,
          memoryLimit: targetSvc.memoryLimit ?? undefined,
          networkIds,
          registryAuth: deployRegistryAuth,
        });

        await ensureIngressRoute(`fleet-account-${accountId}`, swarmServiceName, targetSvc.domain ?? null, targetSvc.sslEnabled ?? true, primaryTargetPort).catch(() => {});

        const updateFields: Record<string, any> = { dockerServiceId: result.id, updatedAt: new Date() };
        if (ingressPorts.length > 0) updateFields.ports = ingressPorts;
        await db.update(services).set(updateFields).where(eq(services.id, targetSvc.id));

        targetSvc.dockerServiceId = result.id;
        logger.info({ serviceId: targetSvc.id, dockerServiceId: result.id }, 'Docker service created');
      }

      // Health check: wait for at least one running task
      await publishProgress(deploymentId, 'deploying', '', 'health_check', undefined, `Waiting for ${targetSvc.name} to become healthy...`);
      await setProgressStep(deploymentId, 'health_check', `Waiting for ${targetSvc.name} to become healthy...`);

      const HEALTH_CHECK_TIMEOUT_MS = 120_000; // 2 minutes
      const HEALTH_CHECK_INTERVAL_MS = 3_000;
      const healthStart = Date.now();
      let healthy = false;
      while (Date.now() - healthStart < HEALTH_CHECK_TIMEOUT_MS) {
        try {
          const tasks = await orchestrator.listTasks({ service: [targetSvc.dockerServiceId!] });
          const runningCount = tasks.filter((t: any) => t.Status?.State === 'running').length;
          if (runningCount > 0) {
            healthy = true;
            break;
          }
        } catch {
          // ignore transient errors
        }
        await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
      }

      if (!healthy) {
        logger.warn({ serviceId: targetSvc.id }, 'Health check timed out — service may not be running');
        await publishProgress(deploymentId, 'deploying', '', 'health_check', undefined, `Health check timed out for ${targetSvc.name}`);
      }

      // Update service image
      await db.update(services)
        .set({ image: targetImageTag, status: 'running', updatedAt: new Date() })
        .where(eq(services.id, targetSvc.id));
    }

    // For compose builds: update primary service with config from the compose file
    if (build.composeServices && build.composeServices.length > 0) {
      const primaryConfig = build.composeServices[0]!;
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (primaryConfig.env && Object.keys(primaryConfig.env).length > 0) updates.env = primaryConfig.env;
      if (primaryConfig.ports && primaryConfig.ports.length > 0) updates.ports = primaryConfig.ports;
      if (primaryConfig.volumes && primaryConfig.volumes.length > 0) updates.volumes = primaryConfig.volumes;
      if (Object.keys(updates).length > 1) {
        await db.update(services).set(updates).where(eq(services.id, svc.id));
        Object.assign(svc, updates);
      }
    }

    // Deploy primary service
    await deployOneService(svc, fullImageTag);

    // For compose builds with multiple services: create and deploy additional services
    if (build.composeServices && build.composeServices.length > 1) {
      const additionalServices = build.composeServices.slice(1); // first one is already deployed above
      logger.info({ serviceId: svc.id, additionalServices: additionalServices.length }, 'Deploying additional compose services');

      for (const composeSvc of additionalServices) {
        try {
          // Check if a service with this name already exists in the same stack
          const existingName = `${svc.name}-${composeSvc.name}`;
          const existing = await db.query.services.findFirst({
            where: and(
              eq(services.accountId, accountId),
              eq(services.name, existingName),
              isNull(services.deletedAt),
            ),
          });

          if (existing) {
            // Update env/ports/volumes from compose config if available
            const updates: Record<string, any> = { updatedAt: new Date() };
            if (composeSvc.env && Object.keys(composeSvc.env).length > 0) updates.env = composeSvc.env;
            if (composeSvc.ports && composeSvc.ports.length > 0) updates.ports = composeSvc.ports;
            if (composeSvc.volumes && composeSvc.volumes.length > 0) updates.volumes = composeSvc.volumes;
            if (Object.keys(updates).length > 1) {
              await db.update(services).set(updates).where(eq(services.id, existing.id));
              // Merge updates into the existing object for deployOneService
              Object.assign(existing, updates);
            }

            await deployOneService(existing, composeSvc.imageTag);
            logger.info({ serviceId: existing.id, composeSvc: composeSvc.name }, 'Updated existing compose service');
          } else {
            // Create new Fleet service record with compose-derived config
            const [newSvc] = await insertReturning(services, {
              accountId,
              name: existingName,
              image: composeSvc.imageTag,
              replicas: svc.replicas ?? 1,
              env: composeSvc.env && Object.keys(composeSvc.env).length > 0 ? composeSvc.env : svc.env,
              ports: composeSvc.ports && composeSvc.ports.length > 0 ? composeSvc.ports : svc.ports,
              volumes: composeSvc.volumes && composeSvc.volumes.length > 0 ? composeSvc.volumes : svc.volumes,
              domain: null, // additional compose services don't get the primary domain
              sslEnabled: svc.sslEnabled,
              sourceType: 'upload',
              sourcePath: svc.sourcePath,
              stackId: svc.stackId,
              status: 'deploying',
            });

            if (newSvc) {
              await deployOneService(newSvc, composeSvc.imageTag);
              logger.info({ serviceId: newSvc.id, composeSvc: composeSvc.name }, 'Created and deployed new compose service');
            }
          }
        } catch (err) {
          logger.error({ err, composeSvc: composeSvc.name }, 'Failed to deploy compose service — continuing with others');
        }
      }
    }

    // Mark deployment as succeeded
    await db.update(deployments)
      .set({ status: 'succeeded', commitSha, progressStep: 'succeeded', completedAt: new Date() })
      .where(eq(deployments.id, deploymentId));

    await publishProgress(deploymentId, 'succeeded', '', 'succeeded');

    // Notify account owners
    const serviceCount = build.composeServices?.length ?? 1;
    notifyAccountMembers(accountId, 'deploy-success', {
      serviceName: serviceCount > 1 ? `${svc.name} (${serviceCount} services)` : svc.name,
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
