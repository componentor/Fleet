import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { backupService } from '../services/backup.service.js';
import { logger, logToErrorTable } from '../services/logger.js';

export interface CreateBackupJobData {
  accountId: string;
  serviceId?: string;
  storageBackend: string;
}

export interface RestoreBackupJobData {
  backupId: string;
  accountId: string;
}

type BackupJobData = CreateBackupJobData | RestoreBackupJobData;

async function processBackupJob(job: Job<BackupJobData>): Promise<void> {
  try {
    if (job.name === 'create-backup') {
      const data = job.data as CreateBackupJobData;
      await backupService.runBackupDirect(
        data.accountId,
        data.serviceId ?? null,
        data.storageBackend,
      );
    } else if (job.name === 'restore-backup') {
      const data = job.data as RestoreBackupJobData;
      await backupService.restoreBackup(data.backupId, data.accountId);
    }
  } catch (err) {
    logger.error({ err, jobName: job.name, jobId: job.id }, 'Backup job failed');
    logToErrorTable({
      level: 'error',
      message: `Backup job failed: ${job.name} — ${String(err)}`,
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { jobName: job.name, jobId: job.id, worker: 'backup', ...job.data },
    });
    throw err;
  }
}

export function createBackupWorker(connection: ConnectionOptions): Worker {
  return new Worker<BackupJobData>('fleet-backup', processBackupJob, {
    connection,
    concurrency: 3,
  });
}
