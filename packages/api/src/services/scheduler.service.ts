import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { db, backupSchedules, backups, nodes, deployments, eq, and, lt } from '@fleet/db';
import { backupService } from './backup.service.js';
import { notificationService } from './notification.service.js';

class SchedulerService {
  private jobs = new Map<string, ScheduledTask>();
  private systemJobs: ScheduledTask[] = [];

  async initialize() {
    const schedules = await db.query.backupSchedules.findMany({
      where: eq(backupSchedules.enabled, true),
    });

    for (const schedule of schedules) {
      this.addJob(schedule.id, schedule.cron);
    }

    // Node health check every 5 minutes
    this.systemJobs.push(
      cron.schedule('*/5 * * * *', () => {
        this.checkNodeHealth().catch(console.error);
      }),
    );

    // Stale deployment cleanup daily at 3 AM UTC
    this.systemJobs.push(
      cron.schedule('0 3 * * *', () => {
        this.cleanupStaleDeployments().catch(console.error);
      }),
    );

    console.log(
      `Scheduler initialized: ${schedules.length} backup schedule(s), 2 system jobs`,
    );
  }

  shutdown() {
    for (const [, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
    for (const job of this.systemJobs) {
      job.stop();
    }
    this.systemJobs = [];
  }

  async onScheduleCreated(scheduleId: string) {
    const schedule = await db.query.backupSchedules.findFirst({
      where: eq(backupSchedules.id, scheduleId),
    });
    if (schedule && schedule.enabled) {
      this.addJob(schedule.id, schedule.cron);
    }
  }

  async onScheduleUpdated(scheduleId: string) {
    this.removeJob(scheduleId);
    const schedule = await db.query.backupSchedules.findFirst({
      where: eq(backupSchedules.id, scheduleId),
    });
    if (schedule && schedule.enabled) {
      this.addJob(schedule.id, schedule.cron);
    }
  }

  onScheduleDeleted(scheduleId: string) {
    this.removeJob(scheduleId);
  }

  private addJob(scheduleId: string, cronExpr: string) {
    if (!cron.validate(cronExpr)) {
      console.error(
        `Invalid cron expression for schedule ${scheduleId}: ${cronExpr}`,
      );
      return;
    }

    const task = cron.schedule(cronExpr, () => {
      this.executeBackupSchedule(scheduleId).catch(console.error);
    });
    this.jobs.set(scheduleId, task);
  }

  private removeJob(scheduleId: string) {
    const existing = this.jobs.get(scheduleId);
    if (existing) {
      existing.stop();
      this.jobs.delete(scheduleId);
    }
  }

  private async executeBackupSchedule(scheduleId: string) {
    const schedule = await db.query.backupSchedules.findFirst({
      where: eq(backupSchedules.id, scheduleId),
    });

    if (!schedule || !schedule.enabled) {
      this.removeJob(scheduleId);
      return;
    }

    try {
      console.log(
        `Executing backup schedule ${scheduleId} for account ${schedule.accountId}`,
      );

      await backupService.createBackup(
        schedule.accountId,
        schedule.serviceId ?? undefined,
        schedule.storageBackend ?? 'nfs',
      );

      // Update lastRunAt
      await db
        .update(backupSchedules)
        .set({ lastRunAt: new Date() })
        .where(eq(backupSchedules.id, scheduleId));

      // Apply retention policy
      await this.applyRetention(schedule);
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

  private async applyRetention(schedule: {
    accountId: string;
    serviceId: string | null;
    retentionDays: number | null;
    retentionCount: number | null;
  }) {
    const allBackups = await db.query.backups.findMany({
      where: schedule.serviceId
        ? and(
            eq(backups.accountId, schedule.accountId),
            eq(backups.serviceId, schedule.serviceId),
          )
        : eq(backups.accountId, schedule.accountId),
      orderBy: (b, { desc: d }) => d(b.createdAt),
    });

    const toDelete: string[] = [];

    // Retention count
    const maxCount = schedule.retentionCount ?? 10;
    if (allBackups.length > maxCount) {
      for (const b of allBackups.slice(maxCount)) {
        toDelete.push(b.id);
      }
    }

    // Retention days
    const maxDays = schedule.retentionDays ?? 30;
    const cutoff = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000);
    for (const b of allBackups) {
      if (b.createdAt && b.createdAt < cutoff && !toDelete.includes(b.id)) {
        toDelete.push(b.id);
      }
    }

    for (const id of toDelete) {
      try {
        await backupService.deleteBackup(id);
      } catch (err) {
        console.error(`Failed to delete expired backup ${id}:`, err);
      }
    }

    if (toDelete.length > 0) {
      console.log(`Retention policy: deleted ${toDelete.length} old backup(s)`);
    }
  }

  private async checkNodeHealth() {
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

  private async cleanupStaleDeployments() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await db.delete(deployments).where(
      and(eq(deployments.status, 'failed'), lt(deployments.createdAt, thirtyDaysAgo)),
    );

    console.log('Stale deployment cleanup complete');
  }
}

export const schedulerService = new SchedulerService();
