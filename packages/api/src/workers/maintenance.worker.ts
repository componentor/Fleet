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

interface DatabaseBackupData {
  type: 'database-backup';
}

type MaintenanceJobData =
  | HealthCheckData
  | StaleCleanupData
  | BackupScheduleData
  | UsageCollectionData
  | StripeUsageReportData
  | AccountDeletionData
  | BillingGraceCheckData
  | DatabaseBackupData;

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
    // Use pastDueSince if available, otherwise fall back to updatedAt
    const pastDueDate = sub.pastDueSince
      ? new Date(sub.pastDueSince)
      : sub.updatedAt ? new Date(sub.updatedAt) : null;
    if (!pastDueDate || pastDueDate > graceCutoff) continue;

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

async function executeDatabaseBackup(): Promise<void> {
  const dbDialect = process.env['DB_DIALECT'] ?? 'sqlite';
  const backupDir = process.env['DB_BACKUP_DIR'] ?? '/var/fleet/backups/database';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const { spawn } = await import('node:child_process');
  const { mkdir, createWriteStream } = await import('node:fs/promises');
  const { createWriteStream: fsCreateWriteStream } = await import('node:fs');
  const { pipeline } = await import('node:stream/promises');

  await mkdir(backupDir, { recursive: true });

  /** Pipe a command's stdout through gzip into a file without using a shell. */
  function pipeToGzip(cmd: string, args: string[], outFile: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let rejected = false;
      const dump = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const gzip = spawn('gzip', [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const out = fsCreateWriteStream(outFile);

      dump.stdout.pipe(gzip.stdin);
      gzip.stdout.pipe(out);

      const STDERR_MAX = 64 * 1024;
      let stderrData = '';
      dump.stderr.on('data', (d: Buffer) => { if (stderrData.length < STDERR_MAX) stderrData += d.toString(); });
      gzip.stderr.on('data', (d: Buffer) => { if (stderrData.length < STDERR_MAX) stderrData += d.toString(); });

      function rejectAndCleanup(err: Error) {
        if (rejected) return;
        rejected = true;
        clearTimeout(timer);
        out.destroy();
        import('node:fs').then(fs => fs.unlink(outFile, () => {}));
        reject(err);
      }

      const timer = setTimeout(() => {
        dump.kill('SIGKILL');
        gzip.kill('SIGKILL');
        rejectAndCleanup(new Error(`Backup timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      let finished = 0;
      const total = 3; // dump exit, gzip exit, out finish
      function checkDone() {
        finished++;
        if (finished >= total) {
          clearTimeout(timer);
          resolve();
        }
      }

      out.on('finish', checkDone);
      dump.on('close', (code) => {
        if (code !== 0) {
          rejectAndCleanup(new Error(`${cmd} exited with code ${code}: ${stderrData}`));
        } else {
          checkDone();
        }
      });
      gzip.on('close', (code) => {
        if (code !== 0) {
          rejectAndCleanup(new Error(`gzip exited with code ${code}: ${stderrData}`));
        } else {
          checkDone();
        }
      });

      dump.on('error', (err) => rejectAndCleanup(err));
      gzip.on('error', (err) => rejectAndCleanup(err));
      out.on('error', (err) => rejectAndCleanup(err));
    });
  }

  if (dbDialect === 'pg' || dbDialect === 'postgres') {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      logger.warn('DATABASE_URL not set — skipping database backup');
      return;
    }

    const backupFile = `${backupDir}/fleet-pg-${timestamp}.sql.gz`;
    try {
      await pipeToGzip('pg_dump', [databaseUrl], backupFile, 5 * 60 * 1000);

      // Rotate old backups — keep last 30
      const { readdir, rm: rmFile } = await import('node:fs/promises');
      const files = (await readdir(backupDir))
        .filter(f => f.startsWith('fleet-pg-') && f.endsWith('.sql.gz'))
        .sort();

      const maxBackups = parseInt(process.env['DB_BACKUP_RETENTION'] ?? '30', 10);
      while (files.length > maxBackups) {
        const old = files.shift()!;
        await rmFile(`${backupDir}/${old}`).catch((err) => {
          logger.error({ err, file: old }, 'Failed to remove old backup file');
        });
      }

      logger.info({ backupFile }, 'PostgreSQL database backup completed');
    } catch (err) {
      logger.error({ err }, 'PostgreSQL database backup failed');
    }
  } else if (dbDialect === 'mysql') {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      logger.warn('DATABASE_URL not set — skipping database backup');
      return;
    }

    const backupFile = `${backupDir}/fleet-mysql-${timestamp}.sql.gz`;
    try {
      await pipeToGzip('mysqldump', ['--single-transaction', databaseUrl], backupFile, 5 * 60 * 1000);
      logger.info({ backupFile }, 'MySQL database backup completed');
    } catch (err) {
      logger.error({ err }, 'MySQL database backup failed');
    }
  } else {
    // SQLite — just copy the file
    const dbPath = process.env['SQLITE_PATH'] ?? './data/fleet.db';
    const backupFile = `${backupDir}/fleet-sqlite-${timestamp}.db`;
    try {
      const { copyFile } = await import('node:fs/promises');
      await copyFile(dbPath, backupFile);
      logger.info({ backupFile }, 'SQLite database backup completed');
    } catch (err) {
      logger.error({ err }, 'SQLite database backup failed');
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
    case 'database-backup':
      await executeDatabaseBackup();
      break;
  }
}

export function createMaintenanceWorker(connection: ConnectionOptions): Worker {
  return new Worker<MaintenanceJobData>('fleet-maintenance', processMaintenanceJob, {
    connection,
    concurrency: 1,
  });
}
