import Redis from 'ioredis';
import { logger } from './logger.js';

const VALKEY_URL = process.env['VALKEY_URL'];

let client: Redis | null = null;
let subscriber: Redis | null = null;
let connectionFailed = false;

function createClient(name: string): Redis | null {
  if (!VALKEY_URL) {
    return null;
  }
  try {
    const redis = new Redis(VALKEY_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) {
          logger.warn({ name, times }, `Valkey ${name}: retry limit reached, will keep trying with longer backoff`);
          return 30_000; // Retry every 30s instead of giving up
        }
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      // MISCONF errors are transient (AOF/RDB rewrite) — don't permanently disable
      const isMisconf = err.message?.includes('MISCONF');
      if (isMisconf) {
        logger.warn({ name }, `Valkey ${name}: transient MISCONF error (RDB/AOF rewrite in progress)`);
        return;
      }
      if (!connectionFailed) {
        logger.error({ error: err.message, name }, `Valkey ${name} error`);
      }
    });

    redis.on('connect', () => {
      connectionFailed = false;
      logger.info({ name }, `Valkey ${name} connected`);
    });

    redis.on('ready', () => {
      connectionFailed = false;
    });

    return redis;
  } catch (err) {
    logger.error({ err, name }, `Failed to create Valkey ${name} client`);
    return null;
  }
}

/**
 * Get the shared Valkey client for commands.
 * Returns null if Valkey is unavailable — callers must handle gracefully.
 */
export async function getValkey(): Promise<Redis | null> {
  if (!VALKEY_URL) return null;

  if (!client) {
    client = createClient('main');
    if (client) {
      try {
        await client.connect();
      } catch {
        client = null;
        return null;
      }
    }
  }

  // Check if the client is usable (connected or reconnecting)
  if (client && client.status !== 'ready' && client.status !== 'connecting' && client.status !== 'reconnecting') {
    client = null;
    return null;
  }

  return client;
}

/**
 * Get a separate Valkey connection for pub/sub.
 * ioredis requires a dedicated connection for subscriptions.
 */
export async function getSubscriber(): Promise<Redis | null> {
  if (!VALKEY_URL) return null;

  if (!subscriber) {
    subscriber = createClient('subscriber');
    if (subscriber) {
      try {
        await subscriber.connect();
      } catch {
        subscriber = null;
        return null;
      }
    }
  }

  return subscriber;
}

/**
 * Get the Valkey connection URL for BullMQ (which manages its own connections).
 */
export function getValkeyConnectionOpts() {
  // Parse the URL to extract components for BullMQ's IORedis options
  try {
    const url = new URL(VALKEY_URL!);
    return {
      host: url.hostname || 'valkey',
      port: Number(url.port) || 6379,
      password: decodeURIComponent(url.password) || undefined,
      maxRetriesPerRequest: null as null, // Required by BullMQ
    };
  } catch {
    if (!VALKEY_URL) {
      return {
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null as null,
      };
    }
    return {
      host: 'valkey',
      port: 6379,
      maxRetriesPerRequest: null as null,
    };
  }
}

/**
 * Gracefully close all Valkey connections.
 */
export async function closeValkey(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (client) {
    promises.push(client.quit().then(() => {}).catch(() => {}));
    client = null;
  }

  if (subscriber) {
    promises.push(subscriber.quit().then(() => {}).catch(() => {}));
    subscriber = null;
  }

  await Promise.all(promises);
}
