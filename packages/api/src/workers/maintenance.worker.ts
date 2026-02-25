import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { db, nodes, deployments, backups, backupSchedules, accounts, services, users, userAccounts, subscriptions, domainRegistrations, domainTldPricing, subdomainClaims, billingConfig, storageVolumes, auditLog, errorLog, logArchives, platformSettings, eq, and, lt, lte, like, isNull, isNotNull, inArray, sql, desc, asc, safeTransaction, updateReturning } from '@fleet/db';
import { backupService } from '../services/backup.service.js';
import { notificationService } from '../services/notification.service.js';
import { usageService } from '../services/usage.service.js';
import { dockerService } from '../services/docker.service.js';
import { eventService, EventTypes } from '../services/event.service.js';
import { getValkey } from '../services/valkey.service.js';
import { logger, logToErrorTable } from '../services/logger.js';

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

interface DataPurgeData {
  type: 'data-purge';
}

interface LogArchiveData {
  type: 'log-archive';
}

interface LogArchiveCleanupData {
  type: 'log-archive-cleanup';
}

interface BackupRetentionCleanupData {
  type: 'backup-retention-cleanup';
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
  | DomainPriceSyncData
  | DataPurgeData
  | LogArchiveData
  | LogArchiveCleanupData
  | BackupRetentionCleanupData;

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
    } else if (svc.status === 'deploying' && tasks.running === 0 && tasks.failed > 0) {
      markFailed.push(svc.id);
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

    const expiresAt = schedule.retentionDays
      ? new Date(Date.now() + schedule.retentionDays * 24 * 60 * 60 * 1000)
      : undefined;

    await backupService.createBackup(
      schedule.accountId,
      schedule.serviceId ?? undefined,
      schedule.storageBackend ?? 'nfs',
      { clusterId: schedule.clusterId ?? undefined, expiresAt },
    );

    await db
      .update(backupSchedules)
      .set({ lastRunAt: new Date() })
      .where(eq(backupSchedules.id, scheduleId));
  } catch (err) {
    logger.error({ err, scheduleId }, `Backup schedule ${scheduleId} failed`);
    logToErrorTable({
      level: 'error',
      message: `Backup schedule ${scheduleId} failed: ${String(err)}`,
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { scheduleId, worker: 'maintenance', task: 'backup' },
    });

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

  // Load config for volume deletion setting
  const config = await db.query.billingConfig.findFirst();
  const volumeDeletionEnabled = config?.volumeDeletionEnabled ?? true;

  logger.info(`Processing ${pendingAccounts.length} scheduled account deletion(s)`);

  for (const account of pendingAccounts) {
    try {
      // Collect owner emails before deletion (we need them for the post-deletion email)
      const ownerMembers = await db.query.userAccounts.findMany({
        where: and(eq(userAccounts.accountId, account.id), eq(userAccounts.role, 'owner')),
        with: { user: true },
      });
      const ownerEmails = ownerMembers.filter((m) => m.user?.email).map((m) => m.user!.email!);

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
        await db.update(services).set({
          deletedAt: new Date(),
          status: 'deleted',
          updatedAt: new Date(),
        }).where(eq(services.id, svc.id));
      }

      // Soft-delete storage volumes if enabled
      if (volumeDeletionEnabled) {
        const accountVolumes = await db.query.storageVolumes.findMany({
          where: and(eq(storageVolumes.accountId, account.id), isNull(storageVolumes.deletedAt)),
        });
        for (const vol of accountVolumes) {
          await db.update(storageVolumes).set({
            status: 'deleting',
            deletedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(storageVolumes.id, vol.id));
        }
        if (accountVolumes.length > 0) {
          logger.info({ accountId: account.id, volumeCount: accountVolumes.length }, 'Marked storage volumes for deletion');
        }
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

        // Soft-delete descendant volumes
        if (volumeDeletionEnabled) {
          const descVolumes = await db.query.storageVolumes.findMany({
            where: and(eq(storageVolumes.accountId, desc.id), isNull(storageVolumes.deletedAt)),
          });
          for (const vol of descVolumes) {
            await db.update(storageVolumes).set({
              status: 'deleting',
              deletedAt: new Date(),
              updatedAt: new Date(),
            }).where(eq(storageVolumes.id, vol.id));
          }
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

      // Post-deletion email + event
      const { emailService } = await import('../services/email.service.js');
      const { getEmailQueue, isQueueAvailable } = await import('../services/queue.service.js');
      for (const email of ownerEmails) {
        const data = { templateSlug: 'account-deleted', to: email, variables: { accountName: account.name ?? 'Your account' }, accountId: account.id };
        if (isQueueAvailable()) {
          await getEmailQueue().add('send-email', data);
        } else {
          emailService.sendTemplateEmail('account-deleted', email, { accountName: account.name ?? 'Your account' }, account.id)
            .catch((err: unknown) => logger.error({ err }, 'Failed to send account-deleted email'));
        }
      }

      eventService.log({
        accountId: account.id,
        eventType: EventTypes.ACCOUNT_DELETED,
        description: `Account permanently deleted after scheduled deletion`,
        resourceType: 'account',
        resourceId: account.id,
        resourceName: account.name ?? undefined,
        source: 'system',
      });

      logger.info(`Account ${account.id} (${account.name}) permanently deleted after grace period`);
    } catch (err) {
      logger.error({ err, accountId: account.id }, 'Failed to execute scheduled account deletion');
      logToErrorTable({
        level: 'error',
        message: `Account deletion failed: ${account.id}`,
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { accountId: account.id, worker: 'maintenance', task: 'account_deletion' },
      });
    }
  }
}

/**
 * Check if a billing warning email should be sent (Valkey-based dedup).
 * Returns true if the warning should be sent (not yet sent or dedup expired).
 */
async function shouldSendBillingWarning(accountId: string, templateSlug: string): Promise<boolean> {
  try {
    const valkey = await getValkey();
    if (!valkey) return true; // No Valkey = no dedup, always send
    const key = `fleet:billing:warned:${accountId}:${templateSlug}`;
    const result = await valkey.set(key, '1', 'EX', 48 * 60 * 60, 'NX');
    return result === 'OK'; // NX returns OK if key didn't exist
  } catch {
    return true; // On error, send the email anyway
  }
}

/**
 * Send a billing-related email + in-app notification to all account owners.
 */
async function notifyAccountOwners(
  accountId: string,
  templateSlug: string,
  variables: Record<string, string>,
  notificationOpts?: { title: string; message: string },
): Promise<void> {
  const { emailService } = await import('../services/email.service.js');
  const { getEmailQueue, isQueueAvailable } = await import('../services/queue.service.js');

  const members = await db.query.userAccounts.findMany({
    where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
    with: { user: true },
  });

  for (const m of members) {
    const email = m.user?.email;
    if (!email) continue;
    const data = { templateSlug, to: email, variables, accountId };
    if (isQueueAvailable()) {
      await getEmailQueue().add('send-email', data);
    } else {
      emailService.sendTemplateEmail(templateSlug, email, variables, accountId)
        .catch((err: unknown) => logger.error({ err }, `Failed to send ${templateSlug} email`));
    }
  }

  if (notificationOpts) {
    try {
      await notificationService.create(accountId, {
        type: 'billing',
        title: notificationOpts.title,
        message: notificationOpts.message,
      });
    } catch { /* notification failure is not critical */ }
  }
}

/**
 * Configurable 3-phase billing grace period enforcement.
 *
 * Phase 1: Suspension warning — send email N days before suspension
 * Phase 2: Suspend account — scale services to 0, optionally schedule deletion
 * Phase 3: Deletion warning — send email N days before scheduled deletion
 */
async function enforceBillingGracePeriod(): Promise<void> {
  // Load config from DB (single row)
  const config = await db.query.billingConfig.findFirst();
  const suspensionGraceDays = config?.suspensionGraceDays ?? 7;
  const deletionGraceDays = config?.deletionGraceDays ?? 14;
  const autoSuspendEnabled = config?.autoSuspendEnabled ?? true;
  const autoDeleteEnabled = config?.autoDeleteEnabled ?? false;
  const suspensionWarningDays = config?.suspensionWarningDays ?? 2;
  const deletionWarningDays = config?.deletionWarningDays ?? 7;
  const appUrl = process.env['APP_URL'] ?? '';

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ── Phase 1 & 2: Handle past_due subscriptions ──

  const overdueSubscriptions = await db.query.subscriptions.findMany({
    where: eq(subscriptions.status, 'past_due'),
  });

  for (const sub of overdueSubscriptions) {
    const pastDueDate = sub.pastDueSince
      ? new Date(sub.pastDueSince)
      : sub.updatedAt ? new Date(sub.updatedAt) : null;
    if (!pastDueDate) continue;

    const daysPastDue = Math.floor((now - pastDueDate.getTime()) / DAY_MS);

    // Look up the account
    const account = await db.query.accounts.findFirst({
      where: and(eq(accounts.id, sub.accountId), isNull(accounts.deletedAt)),
    });
    if (!account || account.status === 'deleted') continue;

    // Phase 1: Suspension warning
    const warningThreshold = suspensionGraceDays - suspensionWarningDays;
    if (daysPastDue >= warningThreshold && daysPastDue < suspensionGraceDays && account.status === 'active') {
      if (await shouldSendBillingWarning(sub.accountId, 'suspension-warning')) {
        const daysRemaining = suspensionGraceDays - daysPastDue;
        await notifyAccountOwners(sub.accountId, 'suspension-warning', {
          accountName: account.name ?? 'Your account',
          daysRemaining: String(daysRemaining),
          billingUrl: `${appUrl}/panel/billing`,
        }, {
          title: 'Payment overdue — suspension imminent',
          message: `Your account will be suspended in ${daysRemaining} day(s) if payment is not received.`,
        });
        logger.info({ accountId: sub.accountId, daysPastDue, daysRemaining }, 'Sent suspension warning email');
      }
    }

    // Phase 2: Suspend account
    if (daysPastDue >= suspensionGraceDays && autoSuspendEnabled && account.status === 'active') {
      try {
        const updateFields: Record<string, any> = {
          status: 'suspended',
          suspendedAt: new Date(),
          updatedAt: new Date(),
        };
        if (autoDeleteEnabled) {
          updateFields.scheduledDeletionAt = new Date(now + deletionGraceDays * DAY_MS);
        }
        await db.update(accounts).set(updateFields).where(eq(accounts.id, sub.accountId));

        // Scale all services to 0
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

        // Email + notification
        await notifyAccountOwners(sub.accountId, 'account-suspended', {
          accountName: account.name ?? 'Your account',
          deletionDays: autoDeleteEnabled ? String(deletionGraceDays) : 'N/A',
          billingUrl: `${appUrl}/panel/billing`,
        }, {
          title: 'Account suspended',
          message: 'Your account has been suspended due to non-payment. Update your billing to restore service.',
        });

        eventService.log({
          accountId: sub.accountId,
          eventType: EventTypes.ACCOUNT_SUSPENDED,
          description: `Account suspended after ${daysPastDue} days past due`,
          resourceType: 'account',
          resourceId: sub.accountId,
          resourceName: account.name ?? undefined,
          source: 'system',
        });

        logger.info({ accountId: sub.accountId, subscriptionId: sub.id, servicesSuspended: accountServices.length, scheduledDeletion: autoDeleteEnabled },
          'Account suspended due to billing grace period expiry');
      } catch (err) {
        logger.error({ err, accountId: sub.accountId }, 'Failed to suspend account for billing grace period');
      }
    }
  }

  // ── Phase 3: Deletion warnings for already-suspended accounts ──

  if (!autoDeleteEnabled) return;

  const suspendedAccounts = await db.query.accounts.findMany({
    where: and(
      eq(accounts.status, 'suspended'),
      isNotNull(accounts.scheduledDeletionAt),
      isNull(accounts.deletedAt),
    ),
  });

  for (const account of suspendedAccounts) {
    if (!account.scheduledDeletionAt) continue;
    const daysUntilDeletion = Math.ceil((new Date(account.scheduledDeletionAt).getTime() - now) / DAY_MS);

    if (daysUntilDeletion <= deletionWarningDays && daysUntilDeletion > 0) {
      if (await shouldSendBillingWarning(account.id, 'deletion-warning')) {
        await notifyAccountOwners(account.id, 'deletion-warning', {
          accountName: account.name ?? 'Your account',
          daysRemaining: String(daysUntilDeletion),
          billingUrl: `${appUrl}/panel/billing`,
        }, {
          title: 'Account scheduled for deletion',
          message: `Your account will be permanently deleted in ${daysUntilDeletion} day(s). Update your billing to prevent data loss.`,
        });
        logger.info({ accountId: account.id, daysUntilDeletion }, 'Sent deletion warning email');
      }
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
  function pipeToGzip(cmd: string, args: string[], outFile: string, timeoutMs: number, env?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      let rejected = false;
      const dump = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : undefined });
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
      await pipeToGzip('pg_dump', ['--dbname', databaseUrl], backupFile, 5 * 60 * 1000);

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
      logToErrorTable({
        level: 'error',
        message: `PostgreSQL database backup failed: ${String(err)}`,
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { worker: 'maintenance', task: 'db_backup', dialect: 'pg' },
      });
    }
  } else if (dbDialect === 'mysql') {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      logger.warn('DATABASE_URL not set — skipping database backup');
      return;
    }

    const backupFile = `${backupDir}/fleet-mysql-${timestamp}.sql.gz`;
    try {
      // Parse DATABASE_URL to pass credentials via env/flags instead of bare URL in process args
      const dbUrl = new URL(databaseUrl);
      const mysqlArgs = [
        '--single-transaction',
        '--host', dbUrl.hostname,
        '--port', dbUrl.port || '3306',
        '--user', decodeURIComponent(dbUrl.username),
        dbUrl.pathname.slice(1), // database name
      ];
      const mysqlEnv = dbUrl.password ? { MYSQL_PWD: decodeURIComponent(dbUrl.password) } : undefined;
      await pipeToGzip('mysqldump', mysqlArgs, backupFile, 5 * 60 * 1000, mysqlEnv);

      // Rotate old backups — keep last N
      const { readdir, rm: rmFile } = await import('node:fs/promises');
      const files = (await readdir(backupDir))
        .filter(f => f.startsWith('fleet-mysql-') && f.endsWith('.sql.gz'))
        .sort();
      const maxBackups = parseInt(process.env['DB_BACKUP_RETENTION'] ?? '30', 10);
      while (files.length > maxBackups) {
        const old = files.shift()!;
        await rmFile(`${backupDir}/${old}`).catch((err) => {
          logger.error({ err, file: old }, 'Failed to remove old MySQL backup file');
        });
      }

      logger.info({ backupFile }, 'MySQL database backup completed');
    } catch (err) {
      logger.error({ err }, 'MySQL database backup failed');
      logToErrorTable({
        level: 'error',
        message: `MySQL database backup failed: ${String(err)}`,
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { worker: 'maintenance', task: 'db_backup', dialect: 'mysql' },
      });
    }
  } else {
    // SQLite — use sqlite3 .backup for consistency (safe during concurrent writes)
    const dbPath = process.env['SQLITE_PATH'] ?? './data/fleet.db';
    const backupFile = `${backupDir}/fleet-sqlite-${timestamp}.db`;
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('sqlite3', [dbPath, `.backup '${backupFile}'`], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`sqlite3 backup failed (code ${code}): ${stderr}`));
        });
        proc.on('error', reject);
      });
      // Rotate old backups — keep last N
      const { readdir, rm: rmFile } = await import('node:fs/promises');
      const sqliteFiles = (await readdir(backupDir))
        .filter(f => f.startsWith('fleet-sqlite-') && f.endsWith('.db'))
        .sort();
      const maxBackups = parseInt(process.env['DB_BACKUP_RETENTION'] ?? '30', 10);
      while (sqliteFiles.length > maxBackups) {
        const old = sqliteFiles.shift()!;
        await rmFile(`${backupDir}/${old}`).catch((err) => {
          logger.error({ err, file: old }, 'Failed to remove old SQLite backup file');
        });
      }

      logger.info({ backupFile }, 'SQLite database backup completed');
    } catch (err) {
      // Fallback to file copy if sqlite3 CLI is not available
      try {
        const { copyFile } = await import('node:fs/promises');
        await copyFile(dbPath, backupFile);
        logger.info({ backupFile }, 'SQLite database backup completed (file copy fallback)');
      } catch (copyErr) {
        logger.error({ err: copyErr }, 'SQLite database backup failed');
        logToErrorTable({
          level: 'error',
          message: `SQLite database backup failed: ${String(copyErr)}`,
          stack: copyErr instanceof Error ? copyErr.stack : undefined,
          metadata: { worker: 'maintenance', task: 'db_backup', dialect: 'sqlite' },
        });
      }
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
    logToErrorTable({
      level: 'error',
      message: `Storage health check failed: ${String(err)}`,
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { worker: 'maintenance', task: 'storage_health' },
    });
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
    // Use a random string to avoid hitting premium domain pricing
    const randomQuery = `fleetpricecheck${Date.now().toString(36)}`;
    const results = await provider.searchDomains(randomQuery, commonTlds);
    let synced = 0;

    for (const result of results) {
      if (!result.price || result.premium) continue;
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

async function executeDataPurge(): Promise<void> {
  try {
    // Load purge config
    const [config] = await db.select().from(billingConfig).limit(1);
    if (!config?.purgeEnabled) {
      logger.info('Data purge skipped — purge is disabled');
      return;
    }

    const retentionDays = config.purgeRetentionDays ?? 30;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    let volumesPurged = 0;
    let servicesPurged = 0;
    let accountsPurged = 0;
    let usersPurged = 0;

    // 1. Hard-purge storage volumes (must happen BEFORE accounts cascade-delete removes DB rows)
    //    We need to clean up files on disk first, then delete the DB rows.
    const expiredVolumes = await db.select()
      .from(storageVolumes)
      .where(and(isNotNull(storageVolumes.deletedAt), lt(storageVolumes.deletedAt, cutoff)));

    if (expiredVolumes.length > 0) {
      const { storageManager } = await import('../services/storage/storage-manager.js');
      for (const vol of expiredVolumes) {
        try {
          // Access the cluster-specific volume provider, fall back to default
          const cluster = vol.clusterId ? storageManager.getCluster(vol.clusterId) : null;
          const provider = cluster?.volumeProvider ?? storageManager.volumes;
          if (provider) {
            await provider.deleteVolume(vol.name);
          }
        } catch (err) {
          // Log but continue — don't let one volume failure block the rest
          logger.warn({ err, volumeId: vol.id, name: vol.name }, 'Failed to delete volume files during purge');
        }
        await db.delete(storageVolumes).where(eq(storageVolumes.id, vol.id));
        volumesPurged++;
      }
    }

    // 2. Hard-purge services where deletedAt < cutoff
    const deletedServices = await db.delete(services)
      .where(and(isNotNull(services.deletedAt), lt(services.deletedAt, cutoff)))
      .returning({ id: services.id });
    servicesPurged = deletedServices.length;

    // 3. Hard-purge accounts where deletedAt < cutoff
    //    FK cascades handle subscriptions, user_accounts, backups, dns_zones, notifications, api_keys, etc.
    const deletedAccounts = await db.delete(accounts)
      .where(and(isNotNull(accounts.deletedAt), lt(accounts.deletedAt, cutoff)))
      .returning({ id: accounts.id });
    accountsPurged = deletedAccounts.length;

    // 4. Hard-purge users where deletedAt < cutoff
    //    FK cascades handle user_accounts, oauth_providers, ssh_keys
    const deletedUsers = await db.delete(users)
      .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, cutoff)))
      .returning({ id: users.id });
    usersPurged = deletedUsers.length;

    const total = volumesPurged + servicesPurged + accountsPurged + usersPurged;
    if (total > 0) {
      logger.info(
        { volumesPurged, servicesPurged, accountsPurged, usersPurged, retentionDays },
        `Data purge completed: ${total} record(s) permanently removed`,
      );
    }
  } catch (err) {
    logger.error({ err }, 'Data purge failed');
  }
}

// ── Log Archive helpers ──

const LOG_ARCHIVE_DIR = process.env['LOG_ARCHIVE_DIR']
  ?? (process.env['NODE_ENV'] === 'production'
    ? '/srv/nfs/log-archives'
    : (await import('node:path')).join(process.cwd(), 'data', 'log-archives'));

async function getSetting(key: string): Promise<unknown | null> {
  const row = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, key),
  });
  return row?.value ?? null;
}

async function executeLogArchive(): Promise<void> {
  try {
    const enabled = await getSetting('platform:logArchive:enabled');
    if (enabled !== true) {
      logger.info('Log archive skipped — not enabled');
      return;
    }

    const retentionDays = ((await getSetting('platform:logArchive:retentionDays')) as number) ?? 90;
    const archiveRetentionDays = ((await getSetting('platform:logArchive:archiveRetentionDays')) as number) ?? 365;
    const auditEnabled = (await getSetting('platform:logArchive:auditLogEnabled')) !== false;
    const errorEnabled = (await getSetting('platform:logArchive:errorLogEnabled')) !== false;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() + archiveRetentionDays * 24 * 60 * 60 * 1000);

    const { mkdir, stat: fsStat, rename, unlink } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { createWriteStream } = await import('node:fs');
    const { createGzip } = await import('node:zlib');
    const { pipeline } = await import('node:stream/promises');
    const { Readable } = await import('node:stream');
    const crypto = await import('node:crypto');

    await mkdir(LOG_ARCHIVE_DIR, { recursive: true });

    let totalArchived = 0;

    // ── Archive audit_log ──
    if (auditEnabled) {
      // Get distinct accountIds (including NULL for system events)
      const accountRows = await db
        .selectDistinct({ accountId: auditLog.accountId })
        .from(auditLog)
        .where(lt(auditLog.createdAt, cutoff));

      for (const row of accountRows) {
        const accountId = row.accountId;
        const condition = accountId
          ? and(eq(auditLog.accountId, accountId), lt(auditLog.createdAt, cutoff))
          : and(isNull(auditLog.accountId), lt(auditLog.createdAt, cutoff));

        // Count and date range
        const [meta] = await db
          .select({
            count: sql<number>`COUNT(*)`,
            minDate: sql<Date>`MIN(${auditLog.createdAt})`,
            maxDate: sql<Date>`MAX(${auditLog.createdAt})`,
          })
          .from(auditLog)
          .where(condition);

        const count = Number(meta?.count ?? 0);
        if (count === 0) continue;

        const dateFrom = meta!.minDate!;
        const dateTo = meta!.maxDate!;
        const shortId = crypto.randomUUID().slice(0, 8);
        const dateFromStr = new Date(dateFrom).toISOString().slice(0, 10);
        const dateToStr = new Date(dateTo).toISOString().slice(0, 10);
        const acctSuffix = accountId ? `-${accountId.slice(0, 8)}` : '-system';
        const filename = `audit${acctSuffix}-${dateFromStr}--${dateToStr}-${shortId}.tar.gz`;
        const filePath = join(LOG_ARCHIVE_DIR, filename);
        const tmpPath = filePath + '.tmp';

        // Insert pending archive row
        const archiveId = crypto.randomUUID();
        await db.insert(logArchives).values({
          id: archiveId,
          logType: 'audit',
          accountId: accountId ?? null,
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo),
          recordCount: count,
          filePath,
          filename,
          status: 'pending',
          expiresAt,
        });

        try {
          // Stream records in batches to JSONL, then gzip
          const BATCH_SIZE = 5000;
          let offset = 0;
          const gzip = createGzip();
          const outStream = createWriteStream(tmpPath);
          const gzipPipeline = pipeline(gzip, outStream);

          while (offset < count) {
            const batch = await db
              .select()
              .from(auditLog)
              .where(condition)
              .orderBy(asc(auditLog.createdAt), asc(auditLog.id))
              .limit(BATCH_SIZE)
              .offset(offset);

            for (const record of batch) {
              gzip.write(JSON.stringify(record) + '\n');
            }
            offset += batch.length;
            if (batch.length < BATCH_SIZE) break;
          }

          gzip.end();
          await gzipPipeline;

          // Rename tmp → final
          await rename(tmpPath, filePath);
          const fileInfo = await fsStat(filePath);

          // Mark completed
          await db.update(logArchives)
            .set({ status: 'completed', sizeBytes: fileInfo.size })
            .where(eq(logArchives.id, archiveId));

          // Delete archived records
          await db.delete(auditLog).where(condition);
          totalArchived += count;

          logger.info(
            { logType: 'audit', accountId, count, filename, sizeBytes: fileInfo.size },
            `Archived ${count} audit log records`,
          );
        } catch (err) {
          logger.error({ err, archiveId }, 'Failed to create audit log archive');
          await db.update(logArchives)
            .set({ status: 'failed' })
            .where(eq(logArchives.id, archiveId));
          // Clean up tmp file if it exists
          try { await unlink(tmpPath); } catch { /* ignore */ }
        }
      }
    }

    // ── Archive error_log ──
    if (errorEnabled) {
      const condition = lt(errorLog.createdAt, cutoff);

      const [meta] = await db
        .select({
          count: sql<number>`COUNT(*)`,
          minDate: sql<Date>`MIN(${errorLog.createdAt})`,
          maxDate: sql<Date>`MAX(${errorLog.createdAt})`,
        })
        .from(errorLog)
        .where(condition);

      const count = Number(meta?.count ?? 0);
      if (count > 0) {
        const dateFrom = meta!.minDate!;
        const dateTo = meta!.maxDate!;
        const shortId = crypto.randomUUID().slice(0, 8);
        const dateFromStr = new Date(dateFrom).toISOString().slice(0, 10);
        const dateToStr = new Date(dateTo).toISOString().slice(0, 10);
        const filename = `error-${dateFromStr}--${dateToStr}-${shortId}.tar.gz`;
        const filePath = join(LOG_ARCHIVE_DIR, filename);
        const tmpPath = filePath + '.tmp';

        const archiveId = crypto.randomUUID();
        await db.insert(logArchives).values({
          id: archiveId,
          logType: 'error',
          accountId: null,
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo),
          recordCount: count,
          filePath,
          filename,
          status: 'pending',
          expiresAt,
        });

        try {
          const { createGzip: cg } = await import('node:zlib');
          const BATCH_SIZE = 5000;
          let offset = 0;
          const gzip = cg();
          const outStream = createWriteStream(tmpPath);
          const gzipPipeline = pipeline(gzip, outStream);

          while (offset < count) {
            const batch = await db
              .select()
              .from(errorLog)
              .where(condition)
              .orderBy(asc(errorLog.createdAt), asc(errorLog.id))
              .limit(BATCH_SIZE)
              .offset(offset);

            for (const record of batch) {
              gzip.write(JSON.stringify(record) + '\n');
            }
            offset += batch.length;
            if (batch.length < BATCH_SIZE) break;
          }

          gzip.end();
          await gzipPipeline;

          await rename(tmpPath, filePath);
          const fileInfo = await fsStat(filePath);

          await db.update(logArchives)
            .set({ status: 'completed', sizeBytes: fileInfo.size })
            .where(eq(logArchives.id, archiveId));

          await db.delete(errorLog).where(condition);
          totalArchived += count;

          logger.info(
            { logType: 'error', count, filename, sizeBytes: fileInfo.size },
            `Archived ${count} error log records`,
          );
        } catch (err) {
          logger.error({ err, archiveId }, 'Failed to create error log archive');
          await db.update(logArchives)
            .set({ status: 'failed' })
            .where(eq(logArchives.id, archiveId));
          try { await unlink(tmpPath); } catch { /* ignore */ }
        }
      }
    }

    if (totalArchived > 0) {
      logger.info({ totalArchived }, `Log archive completed: ${totalArchived} record(s) archived`);
    }
  } catch (err) {
    logger.error({ err }, 'Log archive job failed');
  }
}

async function executeLogArchiveCleanup(): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises');

    const expired = await db
      .select()
      .from(logArchives)
      .where(and(
        lte(logArchives.expiresAt, new Date()),
        eq(logArchives.status, 'completed'),
      ));

    if (expired.length === 0) return;

    let cleaned = 0;
    for (const archive of expired) {
      try {
        await unlink(archive.filePath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.warn({ err, archiveId: archive.id, filePath: archive.filePath }, 'Failed to delete archive file');
        }
      }
      await db.delete(logArchives).where(eq(logArchives.id, archive.id));
      cleaned++;
    }

    logger.info({ cleaned }, `Log archive cleanup: ${cleaned} expired archive(s) removed`);
  } catch (err) {
    logger.error({ err }, 'Log archive cleanup failed');
  }
}

/**
 * Enforce backup retention policies.
 * For each schedule: apply retentionCount and retentionDays.
 * Also clean up any completed backup past its expiresAt.
 * Cascade: when deleting a level-0 backup, also delete all its incrementals.
 */
async function enforceBackupRetention(): Promise<void> {
  try {
    const allSchedules = await db.query.backupSchedules.findMany();
    let totalDeleted = 0;

    for (const schedule of allSchedules) {
      // Find all completed backups for this account+service
      const conditions = [
        eq(backups.accountId, schedule.accountId),
        eq(backups.status, 'completed'),
      ];
      if (schedule.serviceId) {
        conditions.push(eq(backups.serviceId, schedule.serviceId));
      } else {
        conditions.push(isNull(backups.serviceId));
      }

      const scheduleBackups = await db.query.backups.findMany({
        where: and(...conditions),
        orderBy: (b, { desc: d }) => d(b.createdAt),
      });

      const toDelete = new Set<string>();

      // Count retention: keep only retentionCount most recent
      const retentionCount = schedule.retentionCount ?? 10;
      if (scheduleBackups.length > retentionCount) {
        for (const b of scheduleBackups.slice(retentionCount)) {
          toDelete.add(b.id);
        }
      }

      // Age retention: delete backups older than retentionDays
      const retentionDays = schedule.retentionDays ?? 30;
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      for (const b of scheduleBackups) {
        if (b.createdAt && b.createdAt < cutoff) {
          toDelete.add(b.id);
        }
      }

      // Cascade: when deleting a level-0 backup, also delete its incrementals
      const level0Deletions = [...toDelete].filter((id) => {
        const b = scheduleBackups.find((sb) => sb.id === id);
        return b && (b.level ?? 0) === 0;
      });

      for (const parentId of level0Deletions) {
        const children = await db.query.backups.findMany({
          where: and(eq(backups.parentId, parentId), eq(backups.status, 'completed')),
        });
        for (const child of children) {
          toDelete.add(child.id);
        }
      }

      // Delete each backup
      for (const id of toDelete) {
        try {
          await backupService.deleteBackup(id, schedule.accountId);
          totalDeleted++;
        } catch (err) {
          logger.error({ err, backupId: id }, 'Failed to delete backup during retention cleanup');
        }
      }
    }

    // Also clean up by expiresAt — any completed backup past its expiry
    const now = new Date();
    const expiredBackups = await db.query.backups.findMany({
      where: and(
        eq(backups.status, 'completed'),
        isNotNull(backups.expiresAt),
        lt(backups.expiresAt, now),
      ),
    });

    for (const b of expiredBackups) {
      try {
        await backupService.deleteBackup(b.id, b.accountId);
        totalDeleted++;
      } catch (err) {
        logger.error({ err, backupId: b.id }, 'Failed to delete expired backup');
      }
    }

    if (totalDeleted > 0) {
      logger.info({ totalDeleted }, `Backup retention cleanup: deleted ${totalDeleted} backup(s)`);
    }
  } catch (err) {
    logger.error({ err }, 'Backup retention cleanup failed');
    logToErrorTable({
      level: 'error',
      message: `Backup retention cleanup failed: ${String(err)}`,
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { worker: 'maintenance', task: 'backup_retention' },
    });
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
    case 'data-purge':
      await executeDataPurge();
      break;
    case 'log-archive':
      await executeLogArchive();
      break;
    case 'log-archive-cleanup':
      await executeLogArchiveCleanup();
      break;
    case 'backup-retention-cleanup':
      await enforceBackupRetention();
      break;
  }
}

export function createMaintenanceWorker(connection: ConnectionOptions): Worker {
  return new Worker<MaintenanceJobData>('fleet-maintenance', processMaintenanceJob, {
    connection,
    concurrency: 1,
  });
}
