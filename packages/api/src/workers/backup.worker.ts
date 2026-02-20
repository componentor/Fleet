import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { backupService } from '../services/backup.service.js';

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
}

export function createBackupWorker(connection: ConnectionOptions): Worker {
  return new Worker<BackupJobData>('fleet-backup', processBackupJob, {
    connection,
    concurrency: 3,
  });
}
