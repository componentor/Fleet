import { db, backupSchedules, eq } from '@fleet/db';
import { getMaintenanceQueue, isQueueAvailable } from './queue.service.js';
import { logger } from './logger.js';

class SchedulerService {
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    if (!isQueueAvailable()) {
      logger.info('Scheduler skipped — queues not available');
      return;
    }

    // Register system repeatable jobs (BullMQ deduplicates by jobId + repeat key)
    await getMaintenanceQueue().add(
      'health-check',
      { type: 'health-check' },
      {
        repeat: { every: 5 * 60 * 1000 }, // every 5 minutes
        jobId: 'system:health-check',
      },
    );

    await getMaintenanceQueue().add(
      'stale-cleanup',
      { type: 'stale-cleanup' },
      {
        repeat: { pattern: '0 3 * * *' }, // daily at 3 AM UTC
        jobId: 'system:stale-cleanup',
      },
    );

    // Usage collection — every 5 minutes
    await getMaintenanceQueue().add(
      'usage-collection',
      { type: 'usage-collection' },
      {
        repeat: { every: 5 * 60 * 1000 },
        jobId: 'system:usage-collection',
      },
    );

    // Stripe usage reporting — hourly
    await getMaintenanceQueue().add(
      'stripe-usage-report',
      { type: 'stripe-usage-report' },
      {
        repeat: { pattern: '0 * * * *' },
        jobId: 'system:stripe-usage-report',
      },
    );

    // Account deletion — daily at 4 AM UTC (processes expired grace periods)
    await getMaintenanceQueue().add(
      'account-deletion',
      { type: 'account-deletion' },
      {
        repeat: { pattern: '0 4 * * *' },
        jobId: 'system:account-deletion',
      },
    );

    // Billing grace period enforcement — daily at 5 AM UTC
    await getMaintenanceQueue().add(
      'billing-grace-check',
      { type: 'billing-grace-check' },
      {
        repeat: { pattern: '0 5 * * *' },
        jobId: 'system:billing-grace-check',
      },
    );

    // Service status sync — every 30 seconds
    await getMaintenanceQueue().add(
      'service-status-sync',
      { type: 'service-status-sync' },
      {
        repeat: { every: 30 * 1000 },
        jobId: 'system:service-status-sync',
      },
    );

    // Dead container prune — every 10 minutes
    await getMaintenanceQueue().add(
      'container-prune',
      { type: 'container-prune' },
      {
        repeat: { every: 10 * 60 * 1000 },
        jobId: 'system:container-prune',
      },
    );

    // PostgreSQL database backup — daily at 2 AM UTC
    await getMaintenanceQueue().add(
      'database-backup',
      { type: 'database-backup' },
      {
        repeat: { pattern: '0 2 * * *' },
        jobId: 'system:database-backup',
      },
    );

    // Storage health check — every 60 seconds
    await getMaintenanceQueue().add(
      'storage-health-check',
      { type: 'storage-health-check' },
      {
        repeat: { every: 60 * 1000 },
        jobId: 'system:storage-health-check',
      },
    );

    // Domain expiry check — daily at 6 AM UTC
    // Sends expiry warnings, triggers auto-renewal, marks expired domains
    await getMaintenanceQueue().add(
      'domain-expiry-check',
      { type: 'domain-expiry-check' },
      {
        repeat: { pattern: '0 6 * * *' },
        jobId: 'system:domain-expiry-check',
      },
    );

    // Domain price sync — daily at 3:30 AM UTC
    // Fetches current registrar prices and updates TLD pricing table
    await getMaintenanceQueue().add(
      'domain-price-sync',
      { type: 'domain-price-sync' },
      {
        repeat: { pattern: '30 3 * * *' },
        jobId: 'system:domain-price-sync',
      },
    );

    // Data purge — daily at 2 AM UTC
    // Permanently removes soft-deleted records past their retention period
    await getMaintenanceQueue().add(
      'data-purge',
      { type: 'data-purge' },
      {
        repeat: { pattern: '0 2 * * *' },
        jobId: 'system:data-purge',
      },
    );

    // Log archiving — daily at 1:30 AM UTC
    await getMaintenanceQueue().add(
      'log-archive',
      { type: 'log-archive' },
      {
        repeat: { pattern: '30 1 * * *' },
        jobId: 'system:log-archive',
      },
    );

    // Log archive cleanup — daily at 1:45 AM UTC
    await getMaintenanceQueue().add(
      'log-archive-cleanup',
      { type: 'log-archive-cleanup' },
      {
        repeat: { pattern: '45 1 * * *' },
        jobId: 'system:log-archive-cleanup',
      },
    );

    // Backup retention cleanup — daily at 3:30 AM UTC
    await getMaintenanceQueue().add(
      'backup-retention-cleanup',
      { type: 'backup-retention-cleanup' },
      {
        repeat: { pattern: '30 3 * * *' },
        jobId: 'system:backup-retention-cleanup',
      },
    );

    // Registry digest polling — every 60 seconds
    // Checks services with registryPollEnabled for new image digests
    await getMaintenanceQueue().add(
      'registry-poll',
      { type: 'registry-poll' },
      {
        repeat: { every: 60 * 1000 },
        jobId: 'system:registry-poll',
      },
    );

    // Uptime snapshot — every 5 minutes
    // Records health status of core services for the public status page
    await getMaintenanceQueue().add(
      'uptime-snapshot',
      { type: 'uptime-snapshot' },
      {
        repeat: { every: 5 * 60 * 1000 },
        jobId: 'system:uptime-snapshot',
      },
    );

    // Analytics collection — every 5 minutes
    // Scrapes Traefik Prometheus metrics and stores per-service analytics
    await getMaintenanceQueue().add(
      'analytics-collection',
      { type: 'analytics-collection' },
      {
        repeat: { every: 5 * 60 * 1000 },
        jobId: 'system:analytics-collection',
      },
    );

    // Analytics downsampling — every 6 hours
    // Rolls up 5m→1h (after 48h) and 1h→1d (after 30d) to reduce storage
    await getMaintenanceQueue().add(
      'analytics-downsample',
      { type: 'analytics-downsample' },
      {
        repeat: { pattern: '0 */6 * * *' },
        jobId: 'system:analytics-downsample',
      },
    );

    // Visitor analytics — every 5 minutes
    // Parses Traefik JSON access logs and aggregates unique visitors, page views, etc.
    await getMaintenanceQueue().add(
      'visitor-analytics-collection',
      { type: 'visitor-analytics-collection' },
      {
        repeat: { every: 5 * 60 * 1000 },
        jobId: 'system:visitor-analytics-collection',
      },
    );

    // Load backup schedules from DB and register as repeatable jobs
    const schedules = await db.query.backupSchedules.findMany({
      where: eq(backupSchedules.enabled, true),
    });

    for (const schedule of schedules) {
      await this.addScheduleJob(schedule.id, schedule.cron);
    }

    logger.info(
      `Scheduler initialized: ${schedules.length} backup schedule(s), 18 system jobs (BullMQ)`,
    );
  }

  shutdown() {
    // Workers are shut down via queue.service.ts shutdownWorkers()
  }

  async onScheduleCreated(scheduleId: string) {
    const schedule = await db.query.backupSchedules.findFirst({
      where: eq(backupSchedules.id, scheduleId),
    });
    if (schedule && schedule.enabled) {
      await this.addScheduleJob(schedule.id, schedule.cron);
    }
  }

  async onScheduleUpdated(scheduleId: string) {
    await this.removeScheduleJob(scheduleId);
    const schedule = await db.query.backupSchedules.findFirst({
      where: eq(backupSchedules.id, scheduleId),
    });
    if (schedule && schedule.enabled) {
      await this.addScheduleJob(schedule.id, schedule.cron);
    }
  }

  async onScheduleDeleted(scheduleId: string) {
    await this.removeScheduleJob(scheduleId);
  }

  private async addScheduleJob(scheduleId: string, cronExpr: string) {
    try {
      await getMaintenanceQueue().add(
        'backup-schedule',
        { type: 'backup-schedule', scheduleId },
        {
          repeat: { pattern: cronExpr },
          jobId: `backup-${scheduleId}`,
        },
      );
    } catch (err) {
      logger.error(
        { err, scheduleId, cron: cronExpr },
        `Failed to register backup schedule ${scheduleId} (cron: ${cronExpr})`,
      );
    }
  }

  private async removeScheduleJob(scheduleId: string) {
    try {
      const repeatableJobs = await getMaintenanceQueue().getRepeatableJobs();
      const match = repeatableJobs.find((j) => j.id === `backup:${scheduleId}`);
      if (match) {
        await getMaintenanceQueue().removeRepeatableByKey(match.key);
      }
    } catch (err) {
      logger.error({ err, scheduleId }, `Failed to remove backup schedule ${scheduleId}`);
    }
  }
}

export const schedulerService = new SchedulerService();
