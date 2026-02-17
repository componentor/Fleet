import { Queue, Worker } from 'bullmq';
import { getValkey, getValkeyConnectionOpts } from './valkey.service.js';
import { logger } from './logger.js';

// --- Lazy Queue Initialization ---
// Queues are created on first access so the module can be imported
// without immediately connecting to Valkey (important for local dev).

const connection = getValkeyConnectionOpts();

let _deploymentQueue: Queue | null = null;
let _backupQueue: Queue | null = null;
let _maintenanceQueue: Queue | null = null;
let _available = false;

export function isQueueAvailable(): boolean {
  return _available;
}

export function getDeploymentQueue(): Queue {
  if (!_deploymentQueue) _deploymentQueue = new Queue('fleet-deployment', { connection });
  return _deploymentQueue;
}

export function getBackupQueue(): Queue {
  if (!_backupQueue) _backupQueue = new Queue('fleet-backup', { connection });
  return _backupQueue;
}

export function getMaintenanceQueue(): Queue {
  if (!_maintenanceQueue) _maintenanceQueue = new Queue('fleet-maintenance', { connection });
  return _maintenanceQueue;
}

// --- Worker Registry ---

const workers: Worker[] = [];
let initialized = false;

/**
 * Probe Valkey, then start workers if reachable.
 * Silently skips if Valkey is not available (local dev without Docker).
 */
export async function initWorkers(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Probe Valkey connectivity before creating workers
  const valkey = await getValkey();
  if (!valkey) {
    logger.info('Valkey not available — queue workers disabled (local dev mode)');
    return;
  }
  _available = true;

  // Import workers dynamically to avoid circular dependencies
  const [
    { createDeploymentWorker },
    { createBackupWorker },
    { createMaintenanceWorker },
  ] = await Promise.all([
    import('../workers/deployment.worker.js'),
    import('../workers/backup.worker.js'),
    import('../workers/maintenance.worker.js'),
  ]);

  workers.push(
    createDeploymentWorker(connection),
    createBackupWorker(connection),
    createMaintenanceWorker(connection),
  );

  logger.info(`Queue workers started: ${workers.length} workers across 3 queues`);
}

/**
 * Gracefully shut down all workers and close queues.
 */
export async function shutdownWorkers(): Promise<void> {
  // Close workers first (drain running jobs)
  await Promise.all(workers.map((w) => w.close().catch(() => {})));
  workers.length = 0;

  // Close queues
  await Promise.all([
    _deploymentQueue?.close().catch(() => {}),
    _backupQueue?.close().catch(() => {}),
    _maintenanceQueue?.close().catch(() => {}),
  ]);
}
