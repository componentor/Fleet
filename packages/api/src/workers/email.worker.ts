import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { emailService } from '../services/email.service.js';
import { logger, logToErrorTable } from '../services/logger.js';

export interface EmailJobData {
  templateSlug: string;
  to: string;
  variables: Record<string, string>;
  accountId?: string | null;
}

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { templateSlug, to, variables, accountId } = job.data;
  try {
    await emailService.sendTemplateEmail(templateSlug, to, variables, accountId);
  } catch (err) {
    logger.error({ err, jobId: job.id, to, templateSlug }, 'Email job failed');
    logToErrorTable({
      level: 'error',
      message: `Email delivery failed: ${templateSlug} to ${to}`,
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { templateSlug, to, jobId: job.id, worker: 'email' },
    });
    throw err; // Re-throw so BullMQ retries
  }
}

export function createEmailWorker(connection: ConnectionOptions): Worker {
  return new Worker<EmailJobData>('fleet-email', processEmailJob, {
    connection,
    concurrency: 5,
  });
}
