import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { db, auditLog } from '@fleet/db';
import { logger } from './logger.js';

// ── Semantic event types ──────────────────────────────────────────

export const EventTypes = {
  // Services
  SERVICE_CREATED: 'service.created',
  SERVICE_UPDATED: 'service.updated',
  SERVICE_DELETED: 'service.deleted',
  SERVICE_STARTED: 'service.started',
  SERVICE_STOPPED: 'service.stopped',
  SERVICE_RESTARTED: 'service.restarted',
  SERVICE_REDEPLOYED: 'service.redeployed',

  // Deployments
  DEPLOYMENT_TRIGGERED: 'deployment.triggered',
  DEPLOYMENT_SUCCEEDED: 'deployment.succeeded',
  DEPLOYMENT_FAILED: 'deployment.failed',
  DEPLOYMENT_ROLLED_BACK: 'deployment.rolled_back',
  DEPLOYMENT_CANCELLED: 'deployment.cancelled',

  // DNS / Domains
  DNS_ZONE_CREATED: 'dns.zone_created',
  DNS_ZONE_DELETED: 'dns.zone_deleted',
  DNS_RECORD_CREATED: 'dns.record_created',
  DNS_RECORD_UPDATED: 'dns.record_updated',
  DNS_RECORD_DELETED: 'dns.record_deleted',

  // Backups
  BACKUP_CREATED: 'backup.created',
  BACKUP_RESTORED: 'backup.restored',
  BACKUP_DELETED: 'backup.deleted',
  BACKUP_SCHEDULED: 'backup.scheduled',

  // Auth / Users
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_REGISTERED: 'user.registered',
  USER_INVITED: 'user.invited',
  USER_REMOVED: 'user.removed',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_SUPER_TOGGLED: 'user.super_toggled',

  // Accounts
  ACCOUNT_CREATED: 'account.created',
  ACCOUNT_UPDATED: 'account.updated',
  ACCOUNT_DELETION_SCHEDULED: 'account.deletion_scheduled',
  ACCOUNT_IMPERSONATED: 'account.impersonated',

  // SSH Keys
  SSH_KEY_ADDED: 'ssh.key_added',
  SSH_KEY_REMOVED: 'ssh.key_removed',

  // API Keys
  API_KEY_CREATED: 'api_key.created',
  API_KEY_REVOKED: 'api_key.revoked',

  // Settings
  SETTINGS_UPDATED: 'settings.updated',

  // Stacks
  STACK_DELETED: 'stack.deleted',
  STACK_RESTARTED: 'stack.restarted',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

// ── Context helper ────────────────────────────────────────────────

/**
 * Extract common event fields from a Hono request context.
 */
export function eventContext(c: Context): {
  userId: string | null;
  accountId: string | null;
  actorEmail: string | null;
  ipAddress: string;
} {
  let userId: string | null = null;
  let accountId: string | null = null;
  let actorEmail: string | null = null;

  try {
    const user = c.get('user') as any;
    userId = user?.userId ?? null;
    actorEmail = user?.email ?? null;
  } catch { /* not authenticated */ }

  try {
    accountId = c.get('accountId') as string | null;
  } catch { /* no tenant context */ }

  let ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    null;

  if (!ip) {
    try {
      const conn = getConnInfo(c);
      ip = conn.remote.address ?? null;
    } catch { /* conninfo unavailable */ }
  }

  return { userId, accountId, actorEmail, ipAddress: ip ?? 'unknown' };
}

// ── Event service ─────────────────────────────────────────────────

interface EventOptions {
  userId?: string | null;
  accountId?: string | null;
  eventType: EventType;
  description: string;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  actorEmail?: string | null;
  ipAddress?: string;
  source?: 'user' | 'system' | 'webhook' | 'api-key';
  details?: Record<string, unknown>;
}

class EventService {
  /**
   * Log a semantic event. Fire-and-forget — never blocks the caller.
   */
  log(opts: EventOptions): void {
    db.insert(auditLog)
      .values({
        userId: opts.userId ?? null,
        accountId: opts.accountId ?? null,
        action: opts.eventType,
        eventType: opts.eventType,
        description: opts.description,
        resourceType: opts.resourceType ?? opts.eventType.split('.')[0] ?? null,
        resourceId: opts.resourceId ?? null,
        resourceName: opts.resourceName ?? null,
        actorEmail: opts.actorEmail ?? null,
        ipAddress: opts.ipAddress ?? null,
        source: opts.source ?? 'user',
        details: opts.details ?? {},
      })
      .catch((err) => {
        logger.error({ err, eventType: opts.eventType }, 'Failed to write event log');
      });
  }
}

export const eventService = new EventService();
