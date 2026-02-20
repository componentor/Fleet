import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { db, nodes, deployments, backupSchedules, accounts, services, userAccounts, subscriptions, domainRegistrations, domainTldPricing, subdomainClaims, eq, and, lt, like, isNull, isNotNull, inArray, safeTransaction, updateReturning } from '@fleet/db';
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

interface ServiceStatusSyncData {
  type: 'service-status-sync';
}

interface ContainerPruneData {
  type: 'container-prune';
}

interface StorageHealthCheckData {
  type: 'storage-health-check';
}

interface StorageMigrationData {
  type: 'storage-migration';
  migrationId: string;
}

interface DomainExpiryCheckData {
  type: 'domain-expiry-check';
}

interface DomainPriceSyncData {
  type: 'domain-price-sync';
}

type MaintenanceJobData =
  | HealthCheckData
  | StaleCleanupData
  | BackupScheduleData
  | UsageCollectionData
  | StripeUsageReportData
  | AccountDeletionData
  | BillingGraceCheckData
  | DatabaseBackupData
  | ServiceStatusSyncData
  | ContainerPruneData
  | StorageHealthCheckData
  | StorageMigrationData
  | DomainExpiryCheckData
  | DomainPriceSyncData;

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

async function syncServiceStatus(): Promise<void> {
  // 1) Single bulk DB query: all non-deleted services that claim running/deploying
  //    Only select the columns we need to minimize data transfer
  const toCheck = await db.query.services.findMany({
    where: and(isNull(services.deletedAt)),
    columns: { id: true, name: true, status: true, dockerServiceId: true, replicas: true },
  });

  const active = toCheck.filter((s) => s.status === 'running' || s.status === 'deploying');
  if (active.length === 0) return;

  // 2) Two parallel Docker API calls — O(1) regardless of service count
  //    Docker returns ALL fleet-labelled services and tasks in bulk
  let dockerSvcSet: Set<string>;
  let tasksByService: Map<string, { running: number; failed: number; total: number }>;
  try {
    const [allDockerSvcs, allTasks] = await Promise.all([
      dockerService.listServices({ label: ['fleet.service-id'] }),
      dockerService.listTasks({ label: ['fleet.service-id'] }),
    ]);

    // O(n) set build for O(1) lookups
    dockerSvcSet = new Set(allDockerSvcs.map((s: any) => s.ID));

    // Aggregate task states per Docker service ID in single pass
    tasksByService = new Map();
    for (const t of allTasks) {
      const svcId = t.ServiceID;
      if (!svcId) continue;
      let entry = tasksByService.get(svcId);
      if (!entry) {
        entry = { running: 0, failed: 0, total: 0 };
        tasksByService.set(svcId, entry);
      }
      entry.total++;
      const state = t.Status?.State;
      if (state === 'running') entry.running++;
      else if (state === 'failed' || state === 'rejected') entry.failed++;
    }
  } catch (err) {
    logger.error({ err }, 'Service status sync: failed to query Docker — skipping');
    return;
  }

  // 3) Classify services into batch update buckets — single pass O(n)
  const markStopped: string[] = [];       // status → stopped
  const markStoppedClear: string[] = [];   // status → stopped + clear dockerServiceId
  const markFailed: string[] = [];         // status → failed
  const markRunning: string[] = [];        // status → running (deploying → running)

  for (const svc of active) {
    if (!svc.dockerServiceId) {
      markStopped.push(svc.id);
      continue;
    }

    if (!dockerSvcSet.has(svc.dockerServiceId)) {
      markStoppedClear.push(svc.id);
      continue;
    }

    const tasks = tasksByService.get(svc.dockerServiceId) ?? { running: 0, failed: 0, total: 0 };

    if (svc.status === 'running' && tasks.running === 0 && tasks.failed > 0 && tasks.total > 0) {
      markFailed.push(svc.id);
    } else if (svc.status === 'deploying' && tasks.running > 0) {
      markRunning.push(svc.id);
    }
  }

  // 4) Batch DB updates — at most 4 queries regardless of service count
  const now = new Date();
  const updates: Promise<any>[] = [];

  if (markStopped.length > 0) {
    updates.push(
      db.update(services).set({ status: 'stopped', updatedAt: now }).where(inArray(services.id, markStopped)),
    );
  }
  if (markStoppedClear.length > 0) {
    updates.push(
      db.update(services).set({ status: 'stopped', dockerServiceId: null, updatedAt: now }).where(inArray(services.id, markStoppedClear)),
    );
  }
  if (markFailed.length > 0) {
    updates.push(
      db.update(services).set({ status: 'failed', updatedAt: now }).where(inArray(services.id, markFailed)),
    );
  }
  if (markRunning.length > 0) {
    updates.push(
      db.update(services).set({ status: 'running', updatedAt: now }).where(inArray(services.id, markRunning)),
    );
  }

  await Promise.all(updates);

  const total = markStopped.length + markStoppedClear.length + markFailed.length + markRunning.length;
  if (total > 0) {
    logger.info(
      { stopped: markStopped.length + markStoppedClear.length, failed: markFailed.length, running: markRunning.length },
      `Service status sync: updated ${total}/${active.length} service(s)`,
    );
  }
}

async function cleanupStaleDeployments(): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  await db.delete(deployments).where(
    and(eq(deployments.status, 'failed'), lt(deployments.createdAt, thirtyDaysAgo)),
  );

  // Clean up abandoned subdomain checkout sessions (pending_payment > 1 hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const staleClaims = await db.query.subdomainClaims.findMany({
    where: and(
      eq(subdomainClaims.status, 'pending_payment'),
      lt(subdomainClaims.createdAt, oneHourAgo),
    ),
    columns: { id: true },
  });
  if (staleClaims.length > 0) {
    await db.delete(subdomainClaims)
      .where(inArray(subdomainClaims.id, staleClaims.map((c) => c.id)));
    logger.info({ count: staleClaims.length }, 'Cleaned up stale pending subdomain claims');
  }

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

    // Suspend the account and stop all running services
    try {
      await db.update(accounts).set({
        status: 'suspended',
        updatedAt: new Date(),
      }).where(eq(accounts.id, sub.accountId));

      // Stop all running Docker services for this account
      const accountServices = await db.query.services.findMany({
        where: and(eq(services.accountId, sub.accountId), isNull(services.deletedAt), isNotNull(services.dockerServiceId)),
        columns: { id: true, name: true, dockerServiceId: true },
      });
      for (const svc of accountServices) {
        try {
          if (svc.dockerServiceId) {
            await dockerService.scaleService(svc.dockerServiceId, 0);
            await db.update(services).set({ status: 'suspended', updatedAt: new Date() }).where(eq(services.id, svc.id));
          }
        } catch (svcErr) {
          logger.error({ err: svcErr, serviceId: svc.id }, 'Failed to suspend service for billing');
        }
      }

      logger.info({ accountId: sub.accountId, subscriptionId: sub.id, servicesSuspended: accountServices.length },
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
  const { mkdir } = await import('node:fs/promises');
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

async function checkStorageHealth(): Promise<void> {
  try {
    const { storageManager } = await import('../services/storage/storage-manager.js');
    const { db, storageClusters, storageNodes, eq } = await import('@fleet/db');
    const { notificationService } = await import('../services/notification.service.js');

    const health = await storageManager.getHealth();

    // Update cluster status in DB
    const cluster = await db.query.storageClusters.findFirst();
    if (cluster) {
      let clusterStatus = 'healthy';
      if (health.volumes.status === 'error' || health.objects.status === 'error') {
        clusterStatus = 'error';
      } else if (health.volumes.status === 'degraded' || health.objects.status === 'degraded') {
        clusterStatus = 'degraded';
      }

      // Only update if status changed
      if (cluster.status !== clusterStatus) {
        await db.update(storageClusters).set({
          status: clusterStatus,
          updatedAt: new Date(),
        }).where(eq(storageClusters.id, cluster.id));

        logger.info({ previous: cluster.status, current: clusterStatus }, 'Storage cluster status changed');

        // Send notification if degraded or error
        if (clusterStatus === 'degraded' || clusterStatus === 'error') {
          try {
            // Notify all super admin accounts
            const { users: usersTable } = await import('@fleet/db');
            const superUsers = await db.query.users.findMany({
              where: eq(usersTable.isSuper, true),
              columns: { id: true },
            });
            for (const su of superUsers) {
              // Get any account for the super user to attach notification to
              const membership = await db.query.userAccounts.findFirst({
                where: eq(userAccounts.userId, su.id),
              });
              if (membership) {
                await notificationService.create(membership.accountId, {
                  type: 'system_alert',
                  title: `Storage cluster ${clusterStatus}`,
                  message: `Volume provider: ${health.volumes.status} (${health.volumes.message ?? 'no details'}). Object provider: ${health.objects.status} (${health.objects.message ?? 'no details'}).`,
                });
              }
            }
          } catch {
            // Notification failure is not critical
          }
        }
      }
    }

    // Update per-node health if node data is available
    if (health.volumes.nodes) {
      for (const nodeHealth of health.volumes.nodes) {
        const sNode = await db.query.storageNodes.findFirst({
          where: eq(storageNodes.ipAddress, nodeHealth.ipAddress),
        });
        if (sNode) {
          await db.update(storageNodes).set({
            status: nodeHealth.status === 'healthy' ? 'active' : 'offline',
            usedGb: nodeHealth.usedGb ?? sNode.usedGb,
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          }).where(eq(storageNodes.id, sNode.id));
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Storage health check failed');
  }
}

async function executeStorageMigration(migrationId: string): Promise<void> {
  try {
    const { migrationService } = await import('../services/storage/migration.service.js');
    await migrationService.executeMigration(migrationId);
  } catch (err) {
    logger.error({ err, migrationId }, 'Storage migration job failed');
  }
}

/**
 * Domain renewal billing timeline (runs daily at 6 AM UTC):
 *
 *  45 days before expiry — Notification: "Your domain will auto-renew. You'll be charged $X."
 *  30 days before expiry — Create Stripe invoice (charges customer's card).
 *                          This gives 30 days buffer before we need to pay the registrar.
 *  After invoice paid    — Renew with registrar immediately (via invoice.paid webhook).
 *  14 days before expiry — Reminder if invoice still unpaid.
 *   7 days before expiry — Final warning if unpaid; disable auto-renewal.
 *   3 days before expiry — Mark domain as expired (safety buffer so registrar doesn't
 *                          auto-charge us for a renewal we haven't been paid for).
 *
 * For domains with autoRenew=false: only send expiry warnings at 30/14/7/3/1 days.
 */
async function checkDomainExpiry(): Promise<void> {
  try {
    const { emailService } = await import('../services/email.service.js');
    const { getEmailQueue, isQueueAvailable } = await import('../services/queue.service.js');
    const { stripeService } = await import('../services/stripe.service.js');

    const now = new Date();
    const fortyFiveDaysFromNow = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

    // Find all active domains expiring within 45 days
    const expiring = await db.query.domainRegistrations.findMany({
      where: and(
        eq(domainRegistrations.status, 'active'),
        isNotNull(domainRegistrations.expiresAt),
        lt(domainRegistrations.expiresAt, fortyFiveDaysFromNow),
      ),
    });

    if (expiring.length === 0) return;

    const appUrl = process.env['APP_URL'] ?? '';

    // Helper to send email (via queue or direct)
    async function sendEmail(templateSlug: string, to: string, variables: Record<string, string>, accountId: string) {
      const data = { templateSlug, to, variables, accountId };
      if (isQueueAvailable()) {
        await getEmailQueue().add('send-email', data);
      } else {
        emailService.sendTemplateEmail(templateSlug, to, variables, accountId)
          .catch((err: unknown) => logger.error({ err }, `Failed to send ${templateSlug} email`));
      }
    }

    // Helper to get account owners
    async function getOwnerEmails(accountId: string): Promise<{ email: string }[]> {
      const members = await db.query.userAccounts.findMany({
        where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
        with: { user: true },
      });
      return members.filter((m) => m.user?.email).map((m) => ({ email: m.user!.email! }));
    }

    // Get renewal pricing for a domain's TLD
    async function getRenewalPrice(domain: string): Promise<{ amountCents: number; currency: string; displayPrice: string } | null> {
      const tld = domain.split('.').slice(1).join('.');
      const pricing = await db.query.domainTldPricing.findFirst({
        where: eq(domainTldPricing.tld, tld),
      });
      if (!pricing) return null;
      const currency = pricing.currency || 'USD';
      return {
        amountCents: pricing.sellRenewalPrice,
        currency,
        displayPrice: `${(pricing.sellRenewalPrice / 100).toFixed(2)} ${currency}`,
      };
    }

    for (const reg of expiring) {
      if (!reg.expiresAt) continue;
      const daysUntilExpiry = Math.ceil((reg.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const expiryDateStr = reg.expiresAt.toISOString().split('T')[0]!;

      // ── Auto-renew flow (autoRenew=true) ──
      if (reg.autoRenew) {
        const price = await getRenewalPrice(reg.domain);

        // 45 days: Send advance notification about upcoming charge
        if (daysUntilExpiry === 45 && price) {
          const chargeDate = new Date(reg.expiresAt.getTime() - 30 * 24 * 60 * 60 * 1000);
          const owners = await getOwnerEmails(reg.accountId);
          for (const owner of owners) {
            await sendEmail('domain-renewal-upcoming', owner.email, {
              domain: reg.domain,
              chargeDate: chargeDate.toISOString().split('T')[0]!,
              amount: price.displayPrice,
              manageUrl: `${appUrl}/panel/domains`,
            }, reg.accountId);
          }
          logger.info({ domain: reg.domain, daysUntilExpiry }, 'Sent domain renewal advance notice');
        }

        // 30 days: Create Stripe invoice to charge customer
        if (daysUntilExpiry <= 30 && daysUntilExpiry > 7 && price) {
          // Look up the account's Stripe customer
          const account = await db.query.accounts.findFirst({
            where: and(eq(accounts.id, reg.accountId), isNull(accounts.deletedAt)),
          });

          if (account?.stripeCustomerId) {
            // Check if we already created an invoice for this renewal
            const existingInvoice = await stripeService.findDomainRenewalInvoice(
              account.stripeCustomerId,
              reg.id,
            );

            if (!existingInvoice) {
              // Create the invoice — Stripe charges the customer's default payment method
              try {
                const invoice = await stripeService.createDomainRenewalInvoice(
                  account.stripeCustomerId,
                  reg.domain,
                  price.amountCents,
                  price.currency,
                  1, // 1 year renewal
                  reg.accountId,
                  reg.id,
                );
                logger.info({ domain: reg.domain, invoiceId: invoice.id, amount: price.amountCents, registrationId: reg.id },
                  'Created Stripe invoice for domain auto-renewal');

                // If invoice was paid immediately, the webhook will handle renewal.
                // If not, Stripe will retry per dunning settings.
              } catch (err) {
                logger.error({ err, domain: reg.domain, registrationId: reg.id }, 'Failed to create Stripe invoice for domain renewal');

                // Notify owners about the failure
                const owners = await getOwnerEmails(reg.accountId);
                for (const owner of owners) {
                  await sendEmail('domain-renewal-failed', owner.email, {
                    domain: reg.domain,
                    expiryDate: expiryDateStr,
                    billingUrl: `${appUrl}/panel/billing`,
                  }, reg.accountId);
                }
              }
            } else if (existingInvoice.status === 'open') {
              // Invoice exists but not paid yet — send reminder at 14 days
              if (daysUntilExpiry === 14) {
                const owners = await getOwnerEmails(reg.accountId);
                for (const owner of owners) {
                  await sendEmail('domain-renewal-failed', owner.email, {
                    domain: reg.domain,
                    expiryDate: expiryDateStr,
                    billingUrl: `${appUrl}/panel/billing`,
                  }, reg.accountId);
                }
                logger.info({ domain: reg.domain, invoiceId: existingInvoice.id }, 'Sent domain renewal payment reminder');
              }
            }
            // If invoice is 'paid', the webhook already handled the registrar renewal
          } else {
            // No Stripe customer — send manual renewal notice
            if (daysUntilExpiry === 30 || daysUntilExpiry === 14) {
              const owners = await getOwnerEmails(reg.accountId);
              for (const owner of owners) {
                await sendEmail('domain-expiry', owner.email, {
                  domain: reg.domain,
                  expiryDate: expiryDateStr,
                  renewUrl: `${appUrl}/panel/domains`,
                }, reg.accountId);
              }
            }
          }
        }

        // 7 days: Final warning — if invoice still unpaid, disable auto-renewal
        if (daysUntilExpiry === 7) {
          const account = await db.query.accounts.findFirst({
            where: and(eq(accounts.id, reg.accountId), isNull(accounts.deletedAt)),
          });

          let invoicePaid = false;
          if (account?.stripeCustomerId) {
            const invoice = await stripeService.findDomainRenewalInvoice(account.stripeCustomerId, reg.id);
            invoicePaid = invoice?.status === 'paid';
          }

          if (!invoicePaid) {
            // Disable auto-renewal — we won't renew without payment
            await db.update(domainRegistrations)
              .set({ autoRenew: false })
              .where(eq(domainRegistrations.id, reg.id));

            const owners = await getOwnerEmails(reg.accountId);
            for (const owner of owners) {
              await sendEmail('domain-expiry', owner.email, {
                domain: reg.domain,
                expiryDate: expiryDateStr,
                renewUrl: `${appUrl}/panel/domains`,
              }, reg.accountId);
            }
            logger.warn({ domain: reg.domain, registrationId: reg.id },
              'Disabled auto-renewal — payment not received 7 days before expiry');
          }
        }

        continue;
      }

      // ── Manual renewal flow (autoRenew=false) ──
      // Send expiry warnings at specific intervals
      const notifyDays = [30, 14, 7, 3, 1];
      if (!notifyDays.includes(daysUntilExpiry)) continue;

      const owners = await getOwnerEmails(reg.accountId);
      for (const owner of owners) {
        await sendEmail('domain-expiry', owner.email, {
          domain: reg.domain,
          expiryDate: expiryDateStr,
          renewUrl: `${appUrl}/panel/domains`,
        }, reg.accountId);
      }
    }

    // Mark domains as expired 3 days before actual expiry — safety buffer so the
    // registrar doesn't auto-charge us for a renewal we haven't been paid for.
    const SAFETY_BUFFER_MS = 3 * 24 * 60 * 60 * 1000;
    const safetyDate = new Date(now.getTime() + SAFETY_BUFFER_MS);
    const expired = expiring.filter((r) => r.expiresAt && r.expiresAt < safetyDate);
    if (expired.length > 0) {
      await db.update(domainRegistrations)
        .set({ status: 'expired' })
        .where(inArray(domainRegistrations.id, expired.map((r) => r.id)));
      logger.info({ count: expired.length }, 'Marked expired domain registrations (3-day safety buffer)');
    }

    logger.info({ total: expiring.length, expired: expired.length }, 'Domain expiry check complete');
  } catch (err) {
    logger.error({ err }, 'Domain expiry check failed');
  }
}

function computeSellPrice(providerPrice: number, markupType: string, markupValue: number): number {
  switch (markupType) {
    case 'percentage':
      return Math.ceil(providerPrice * (1 + markupValue / 100));
    case 'fixed_amount':
      return providerPrice + markupValue;
    case 'fixed_price':
      return markupValue;
    default:
      return providerPrice;
  }
}

async function syncDomainPrices(): Promise<void> {
  try {
    const { registrarService } = await import('../services/registrar.service.js');

    const provider = await registrarService.getProvider();
    if (provider.name === 'simulated') {
      // Don't sync prices from the simulated provider — it has hardcoded values
      return;
    }

    const commonTlds = ['com', 'net', 'org', 'io', 'dev', 'app', 'co', 'xyz', 'me', 'ai', 'no', 'se', 'dk', 'fi'];
    const results = await provider.searchDomains('test', commonTlds);
    let synced = 0;

    for (const result of results) {
      if (!result.price) continue;
      const tld = result.domain.split('.').slice(1).join('.');

      const existing = await db.query.domainTldPricing.findFirst({
        where: eq(domainTldPricing.tld, tld),
      });

      const regPriceCents = Math.round(result.price.registration * 100);
      const renPriceCents = Math.round(result.price.renewal * 100);

      if (existing) {
        // Only update if prices actually changed
        if (existing.providerRegistrationPrice === regPriceCents && existing.providerRenewalPrice === renPriceCents) {
          continue;
        }

        const sellReg = computeSellPrice(regPriceCents, existing.markupType, existing.markupValue);
        const sellRen = computeSellPrice(renPriceCents, existing.markupType, existing.markupValue);

        await updateReturning(domainTldPricing, {
          providerRegistrationPrice: regPriceCents,
          providerRenewalPrice: renPriceCents,
          sellRegistrationPrice: sellReg,
          sellRenewalPrice: sellRen,
          updatedAt: new Date(),
        }, eq(domainTldPricing.id, existing.id));

        logger.info({ tld, oldReg: existing.providerRegistrationPrice, newReg: regPriceCents, oldRen: existing.providerRenewalPrice, newRen: renPriceCents },
          `Domain price updated for .${tld}`);
      }
      // Don't auto-create new TLD pricing entries — that's an admin decision
      synced++;
    }

    if (synced > 0) {
      logger.info({ synced }, 'Domain price sync complete');
    }
  } catch (err) {
    logger.error({ err }, 'Domain price sync failed');
  }
}

async function pruneDeadContainers(): Promise<void> {
  try {
    const removed = await dockerService.pruneDeadContainers();
    if (removed > 0) {
      logger.info({ removed }, `Container prune: removed ${removed} dead container(s)`);
    }
  } catch (err) {
    logger.error({ err }, 'Container prune failed');
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
    case 'service-status-sync':
      await syncServiceStatus();
      break;
    case 'container-prune':
      await pruneDeadContainers();
      break;
    case 'storage-health-check':
      await checkStorageHealth();
      break;
    case 'storage-migration':
      await executeStorageMigration((job.data as StorageMigrationData).migrationId);
      break;
    case 'domain-expiry-check':
      await checkDomainExpiry();
      break;
    case 'domain-price-sync':
      await syncDomainPrices();
      break;
  }
}

export function createMaintenanceWorker(connection: ConnectionOptions): Worker {
  return new Worker<MaintenanceJobData>('fleet-maintenance', processMaintenanceJob, {
    connection,
    concurrency: 1,
  });
}
