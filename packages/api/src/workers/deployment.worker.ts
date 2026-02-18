import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { db, services, deployments, oauthProviders, eq, and, isNull } from '@fleet/db';
import { buildService } from '../services/build.service.js';
import { dockerService } from '../services/docker.service.js';
import { githubService } from '../services/github.service.js';
import { getValkey } from '../services/valkey.service.js';
import { decrypt } from '../services/crypto.service.js';
import { logger } from '../services/logger.js';

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
  const result = await db.query.oauthProviders.findFirst({
    where: eq(oauthProviders.provider, 'github'),
    with: {
      user: {
        with: {
          userAccounts: true,
        },
      },
    },
  });

  if (!result?.accessToken) return null;

  const hasAccess = result.user.userAccounts.some(
    (ua) => ua.accountId === accountId,
  );

  return hasAccess ? decrypt(result.accessToken) : null;
}

async function publishProgress(deploymentId: string, status: string, log: string) {
  const valkey = await getValkey();
  if (valkey) {
    await valkey.publish(`deploy:${deploymentId}`, JSON.stringify({ status, log })).catch((err) => {
      logger.error({ err, deploymentId }, 'Failed to publish deployment progress');
    });
  }
}

async function processDeployment(job: Job<DeploymentJobData>): Promise<void> {
  const { deploymentId, serviceId, accountId, commitSha, sourceType, sourcePath, buildMethod, buildFile } = job.data;

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    await db.update(deployments)
      .set({ status: 'failed', log: 'Service not found' })
      .where(eq(deployments.id, deploymentId));
    return;
  }

  const imageTag = `${accountId.slice(0, 8)}-${svc.name}:${commitSha?.slice(0, 7) ?? Date.now()}`;

  try {
    let buildInfo;

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

      buildInfo = await buildService.buildImage({
        serviceId: svc.id,
        cloneUrl,
        branch: svc.githubBranch,
        imageTag,
      });
    }

    // Wait for build to complete
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = buildService.onBuildUpdate(buildInfo.id, (info) => {
        // Update deployment in DB and publish progress
        db.update(deployments)
          .set({
            log: info.log,
            status: info.status === 'succeeded' ? 'deploying'
              : info.status === 'failed' ? 'failed'
              : 'building',
          })
          .where(eq(deployments.id, deploymentId))
          .then(() => publishProgress(deploymentId, info.status, info.log))
          .catch((err) => {
            logger.error({ err, deploymentId }, 'Failed to update deployment status in DB');
          });

        if (info.status === 'succeeded') {
          unsubscribe();
          resolve();
        } else if (info.status === 'failed' || info.status === 'cancelled') {
          unsubscribe();
          reject(new Error(`Build ${info.status}`));
        }
      });
    });

    // Deploy the newly built image
    const fullImageTag = buildInfo.imageTag;

    await db.update(deployments)
      .set({ status: 'deploying', imageTag: fullImageTag })
      .where(eq(deployments.id, deploymentId));

    await publishProgress(deploymentId, 'deploying', '');

    if (svc.dockerServiceId) {
      await dockerService.updateService(svc.dockerServiceId, {
        image: fullImageTag,
      });
    }

    // Mark as succeeded
    await db.update(deployments)
      .set({ status: 'succeeded', commitSha })
      .where(eq(deployments.id, deploymentId));

    await db.update(services)
      .set({ image: fullImageTag, status: 'running', updatedAt: new Date() })
      .where(eq(services.id, svc.id));

    await publishProgress(deploymentId, 'succeeded', '');
  } catch (err) {
    await db.update(deployments)
      .set({ status: 'failed', log: `Build/deploy failed: ${String(err)}` })
      .where(eq(deployments.id, deploymentId));

    await db.update(services)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(services.id, svc.id));

    await publishProgress(deploymentId, 'failed', String(err));

    throw err;
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
    concurrency: 50,
  });
}
