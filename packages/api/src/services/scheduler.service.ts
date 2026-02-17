import { db, backupSchedules, eq } from '@fleet/db';
import { getMaintenanceQueue, isQueueAvailable } from './queue.service.js';

class SchedulerService {
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    if (!isQueueAvailable()) {
      console.log('Scheduler skipped — queues not available');
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

    // Load backup schedules from DB and register as repeatable jobs
    const schedules = await db.query.backupSchedules.findMany({
      where: eq(backupSchedules.enabled, true),
    });

    for (const schedule of schedules) {
      await this.addScheduleJob(schedule.id, schedule.cron);
    }

    console.log(
      `Scheduler initialized: ${schedules.length} backup schedule(s), 2 system jobs (BullMQ)`,
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
      console.error(
        `Failed to register backup schedule ${scheduleId} (cron: ${cronExpr}):`,
        err,
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
      console.error(`Failed to remove backup schedule ${scheduleId}:`, err);
    }
  }
}

export const schedulerService = new SchedulerService();
