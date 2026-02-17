import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { db, nodes, deployments, backupSchedules, eq, and, lt } from '@fleet/db';
import { backupService } from '../services/backup.service.js';
import { notificationService } from '../services/notification.service.js';

interface HealthCheckData {
  type: 'health-check';
}

interface StaleCleanupData {
  type: 'stale-cleanup';
}

interface BackupScheduleData {
  type: 'backup-schedule';
  scheduleId: string;
}

type MaintenanceJobData = HealthCheckData | StaleCleanupData | BackupScheduleData;

async function checkNodeHealth(): Promise<void> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const allNodes = await db.query.nodes.findMany();

  for (const node of allNodes) {
    const isStale = !node.lastHeartbeat || node.lastHeartbeat < fiveMinAgo;

    if (isStale && node.status === 'active') {
      await db
        .update(nodes)
        .set({ status: 'offline', updatedAt: new Date() })
        .where(eq(nodes.id, node.id));

      console.log(`Node ${node.hostname} marked offline (no heartbeat)`);
    } else if (!isStale && node.status === 'offline') {
      await db
        .update(nodes)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(nodes.id, node.id));

      console.log(`Node ${node.hostname} back online`);
    }
  }
}

async function cleanupStaleDeployments(): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  await db.delete(deployments).where(
    and(eq(deployments.status, 'failed'), lt(deployments.createdAt, thirtyDaysAgo)),
  );

  console.log('Stale deployment cleanup complete');
}

async function executeBackupSchedule(scheduleId: string): Promise<void> {
  const schedule = await db.query.backupSchedules.findFirst({
    where: eq(backupSchedules.id, scheduleId),
  });

  if (!schedule || !schedule.enabled) return;

  try {
    console.log(
      `Executing backup schedule ${scheduleId} for account ${schedule.accountId}`,
    );

    await backupService.createBackup(
      schedule.accountId,
      schedule.serviceId ?? undefined,
      schedule.storageBackend ?? 'nfs',
    );

    await db
      .update(backupSchedules)
      .set({ lastRunAt: new Date() })
      .where(eq(backupSchedules.id, scheduleId));
  } catch (err) {
    console.error(`Backup schedule ${scheduleId} failed:`, err);

    try {
      await notificationService.create(schedule.accountId, {
        type: 'backup_failed',
        title: 'Scheduled backup failed',
        message: `Backup schedule failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } catch {
      // ignore notification failure
    }
  }
}

async function processMaintenanceJob(job: Job<MaintenanceJobData>): Promise<void> {
  switch (job.name) {
    case 'health-check':
      await checkNodeHealth();
      break;
    case 'stale-cleanup':
      await cleanupStaleDeployments();
      break;
    case 'backup-schedule':
      await executeBackupSchedule((job.data as BackupScheduleData).scheduleId);
      break;
  }
}

export function createMaintenanceWorker(connection: ConnectionOptions): Worker {
  return new Worker<MaintenanceJobData>('fleet-maintenance', processMaintenanceJob, {
    connection,
    concurrency: 1,
  });
}
