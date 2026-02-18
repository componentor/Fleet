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

    // Load backup schedules from DB and register as repeatable jobs
    const schedules = await db.query.backupSchedules.findMany({
      where: eq(backupSchedules.enabled, true),
    });

    for (const schedule of schedules) {
      await this.addScheduleJob(schedule.id, schedule.cron);
    }

    logger.info(
      `Scheduler initialized: ${schedules.length} backup schedule(s), 6 system jobs (BullMQ)`,
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
          jobId: `backup:${scheduleId}`,
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
