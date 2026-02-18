import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { db, nodes, deployments, backupSchedules, accounts, services, userAccounts, subscriptions, eq, and, lt, like, isNull, isNotNull, safeTransaction } from '@fleet/db';
import { backupService } from '../services/backup.service.js';
import { notificationService } from '../services/notification.service.js';
import { usageService } from '../services/usage.service.js';
import { dockerService } from '../services/docker.service.js';
import { logger } from '../services/logger.js';

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

interface UsageCollectionData {
  type: 'usage-collection';
}

interface StripeUsageReportData {
  type: 'stripe-usage-report';
}

interface AccountDeletionData {
  type: 'account-deletion';
}

interface BillingGraceCheckData {
  type: 'billing-grace-check';
}

type MaintenanceJobData =
  | HealthCheckData
  | StaleCleanupData
  | BackupScheduleData
  | UsageCollectionData
  | StripeUsageReportData
  | AccountDeletionData
  | BillingGraceCheckData;

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

      logger.info(`Node ${node.hostname} marked offline (no heartbeat)`);
    } else if (!isStale && node.status === 'offline') {
      await db
        .update(nodes)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(nodes.id, node.id));

      logger.info(`Node ${node.hostname} back online`);
    }
  }
}

async function cleanupStaleDeployments(): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  await db.delete(deployments).where(
    and(eq(deployments.status, 'failed'), lt(deployments.createdAt, thirtyDaysAgo)),
  );

  logger.info('Stale deployment cleanup complete');
}

async function executeBackupSchedule(scheduleId: string): Promise<void> {
  const schedule = await db.query.backupSchedules.findFirst({
    where: eq(backupSchedules.id, scheduleId),
  });

  if (!schedule || !schedule.enabled) return;

  try {
    logger.info(
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
    logger.error({ err, scheduleId }, `Backup schedule ${scheduleId} failed`);

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

async function executeScheduledDeletions(): Promise<void> {
  // Find all accounts whose scheduled deletion date has passed
  const now = new Date();
  const pendingAccounts = await db.query.accounts.findMany({
    where: and(
      isNotNull(accounts.scheduledDeletionAt),
      lt(accounts.scheduledDeletionAt, now),
      isNull(accounts.deletedAt),
    ),
  });

  if (pendingAccounts.length === 0) return;

  logger.info(`Processing ${pendingAccounts.length} scheduled account deletion(s)`);

  for (const account of pendingAccounts) {
    try {
      // Find all services for this account and remove from Docker Swarm
      const accountServices = await db.query.services.findMany({
        where: and(eq(services.accountId, account.id), isNull(services.deletedAt)),
      });

      for (const svc of accountServices) {
        if (svc.dockerServiceId) {
          try {
            await dockerService.removeService(svc.dockerServiceId);
          } catch (err) {
            logger.error({ err, serviceId: svc.id }, 'Failed to remove Docker service during account deletion');
          }
        }
        // Soft-delete the service
        await db.update(services).set({
          deletedAt: new Date(),
          status: 'deleted',
          updatedAt: new Date(),
        }).where(eq(services.id, svc.id));
      }

      // Also handle descendants
      const descendants = await db.query.accounts.findMany({
        where: and(like(accounts.path, `${account.path}.%`), isNull(accounts.deletedAt)),
      });

      for (const desc of descendants) {
        const descServices = await db.query.services.findMany({
          where: and(eq(services.accountId, desc.id), isNull(services.deletedAt)),
        });
        for (const svc of descServices) {
          if (svc.dockerServiceId) {
            try {
              await dockerService.removeService(svc.dockerServiceId);
            } catch (err) {
              logger.error({ err, serviceId: svc.id }, 'Failed to remove Docker service during descendant deletion');
            }
          }
          await db.update(services).set({
            deletedAt: new Date(),
            status: 'deleted',
            updatedAt: new Date(),
          }).where(eq(services.id, svc.id));
        }
      }

      // Soft-delete the accounts and remove user-account links
      await safeTransaction(async (tx) => {
        const allAccountIds = [account.id, ...descendants.map((d) => d.id)];

        for (const accId of allAccountIds) {
          await tx.delete(userAccounts).where(eq(userAccounts.accountId, accId));
          await tx.update(accounts).set({
            deletedAt: new Date(),
            status: 'deleted',
            updatedAt: new Date(),
          }).where(eq(accounts.id, accId));
        }
      });

      logger.info(`Account ${account.id} (${account.name}) permanently deleted after grace period`);
    } catch (err) {
      logger.error({ err, accountId: account.id }, 'Failed to execute scheduled account deletion');
    }
  }
}

async function enforceBillingGracePeriod(): Promise<void> {
  const GRACE_DAYS = 7;
  const graceCutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);

  // Find subscriptions that have been past_due for longer than the grace period
  const overdueSubscriptions = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.status, 'past_due'),
    ),
  });

  for (const sub of overdueSubscriptions) {
    // Check if the subscription has been past_due since before the grace cutoff
    // Use updatedAt as proxy for when it became past_due
    const updatedAt = sub.updatedAt ? new Date(sub.updatedAt) : null;
    if (!updatedAt || updatedAt > graceCutoff) continue;

    // Suspend the account
    try {
      await db.update(accounts).set({
        status: 'suspended',
        updatedAt: new Date(),
      }).where(eq(accounts.id, sub.accountId));

      logger.info({ accountId: sub.accountId, subscriptionId: sub.id },
        'Account suspended due to billing grace period expiry');
    } catch (err) {
      logger.error({ err, accountId: sub.accountId },
        'Failed to suspend account for billing grace period');
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
    case 'usage-collection':
      await usageService.collectUsage();
      break;
    case 'stripe-usage-report':
      await usageService.reportUsageToStripe();
      break;
    case 'account-deletion':
      await executeScheduledDeletions();
      break;
    case 'billing-grace-check':
      await enforceBillingGracePeriod();
      break;
  }
}

export function createMaintenanceWorker(connection: ConnectionOptions): Worker {
  return new Worker<MaintenanceJobData>('fleet-maintenance', processMaintenanceJob, {
    connection,
    concurrency: 1,
  });
}
