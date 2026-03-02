import { Worker, type ConnectionOptions } from 'bullmq';
import { logger } from '../services/logger.js';
import {
  launchWorkerContainer,
  waitForContainerRunning,
  cleanupContainer,
} from '../services/self-healing.service.js';

interface SelfHealingJobData {
  jobId: string;
}

export function createSelfHealingWorker(connection: ConnectionOptions): Worker {
  return new Worker<SelfHealingJobData>(
    'fleet-selfhealing',
    async (job) => {
      const { jobId } = job.data;
      logger.info({ jobId }, 'Self-healing worker: starting job');

      let serviceId: string | undefined;
      try {
        // Launch the container
        serviceId = await launchWorkerContainer(jobId);
        logger.info({ jobId, serviceId }, 'Self-healing worker: container launched');

        // Wait for it to become running
        const containerId = await waitForContainerRunning(jobId, serviceId);
        if (!containerId) {
          logger.warn({ jobId }, 'Self-healing worker: container failed to start');
          return;
        }

        logger.info({ jobId, containerId }, 'Self-healing worker: container running');

        // The container handles everything else via callbacks.
        // We just need to wait for it to finish. Poll every 10s for up to 2 hours.
        const { orchestrator } = await import('../services/orchestrator.js');
        const maxWait = 2 * 60 * 60 * 1000; // 2 hours
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          await new Promise((r) => setTimeout(r, 10_000));

          try {
            const tasks = await orchestrator.listTasks({
              service: [serviceId],
            });

            const allDone = tasks.length > 0 && tasks.every(
              (t: any) => t.Status?.State === 'complete' || t.Status?.State === 'failed' || t.Status?.State === 'shutdown',
            );

            if (allDone) {
              logger.info({ jobId }, 'Self-healing worker: container finished');
              break;
            }
          } catch {
            // Orchestrator API error — service may already be removed
            break;
          }
        }
      } catch (err) {
        logger.error({ err, jobId }, 'Self-healing worker: error');
        throw err;
      } finally {
        // Clean up the Docker service after a grace period
        if (serviceId) {
          setTimeout(() => {
            cleanupContainer(serviceId!).catch(() => {});
          }, 60_000); // 60s grace for terminal access
        }
      }
    },
    {
      connection,
      concurrency: 3,
    },
  );
}
