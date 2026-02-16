import { getDialect } from './config.js';
import { _setDb } from './helpers.js';

// PG types used as the compile-time contract for all dialects.
// At runtime, the actual objects come from the active dialect.
import type * as PgSchema from './dialects/pg/schema/index.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

const dialect = getDialect();

let _db: any;
let _schema: any;

if (dialect === 'pg') {
  const mod = await import('./dialects/pg/client.js');
  _db = mod.db;
  _schema = mod;
} else if (dialect === 'mysql') {
  const mod = await import('./dialects/mysql/client.js');
  _db = mod.db;
  _schema = mod;
} else {
  const mod = await import('./dialects/sqlite/client.js');
  _db = mod.db;
  _schema = mod;
}

// Wire up the helpers with the loaded db instance
_setDb(_db);

/** The Drizzle database instance for the active dialect */
export const db = _db as PostgresJsDatabase<typeof PgSchema>;

// --- Table exports (typed as PG schema for consistent autocomplete) ---

// accounts.ts
export const accounts = _schema.accounts as typeof PgSchema.accounts;
export const accountsRelations = _schema.accountsRelations;

// users.ts
export const users = _schema.users as typeof PgSchema.users;
export const userAccounts = _schema.userAccounts as typeof PgSchema.userAccounts;
export const oauthProviders = _schema.oauthProviders as typeof PgSchema.oauthProviders;
export const usersRelations = _schema.usersRelations;
export const userAccountsRelations = _schema.userAccountsRelations;
export const oauthProvidersRelations = _schema.oauthProvidersRelations;

// services.ts
export const services = _schema.services as typeof PgSchema.services;
export const deployments = _schema.deployments as typeof PgSchema.deployments;
export const servicesRelations = _schema.servicesRelations;
export const deploymentsRelations = _schema.deploymentsRelations;

// domains.ts
export const dnsZones = _schema.dnsZones as typeof PgSchema.dnsZones;
export const dnsRecords = _schema.dnsRecords as typeof PgSchema.dnsRecords;
export const domainRegistrars = _schema.domainRegistrars as typeof PgSchema.domainRegistrars;
export const domainRegistrations = _schema.domainRegistrations as typeof PgSchema.domainRegistrations;
export const dnsZonesRelations = _schema.dnsZonesRelations;
export const dnsRecordsRelations = _schema.dnsRecordsRelations;
export const domainRegistrarsRelations = _schema.domainRegistrarsRelations;
export const domainRegistrationsRelations = _schema.domainRegistrationsRelations;

// nodes.ts
export const nodes = _schema.nodes as typeof PgSchema.nodes;
export const nodesRelations = _schema.nodesRelations;

// billing.ts
export const billingPlans = _schema.billingPlans as typeof PgSchema.billingPlans;
export const subscriptions = _schema.subscriptions as typeof PgSchema.subscriptions;
export const usageRecords = _schema.usageRecords as typeof PgSchema.usageRecords;
export const pricingConfig = _schema.pricingConfig as typeof PgSchema.pricingConfig;
export const billingPlansRelations = _schema.billingPlansRelations;
export const subscriptionsRelations = _schema.subscriptionsRelations;
export const usageRecordsRelations = _schema.usageRecordsRelations;
export const pricingConfigRelations = _schema.pricingConfigRelations;

// ssh-keys.ts
export const sshKeys = _schema.sshKeys as typeof PgSchema.sshKeys;
export const sshAccessRules = _schema.sshAccessRules as typeof PgSchema.sshAccessRules;
export const sshKeysRelations = _schema.sshKeysRelations;
export const sshAccessRulesRelations = _schema.sshAccessRulesRelations;

// audit-log.ts
export const auditLog = _schema.auditLog as typeof PgSchema.auditLog;

// backups.ts
export const backups = _schema.backups as typeof PgSchema.backups;
export const backupSchedules = _schema.backupSchedules as typeof PgSchema.backupSchedules;
export const backupsRelations = _schema.backupsRelations;
export const backupSchedulesRelations = _schema.backupSchedulesRelations;

// emails.ts
export const emailTemplates = _schema.emailTemplates as typeof PgSchema.emailTemplates;
export const emailLog = _schema.emailLog as typeof PgSchema.emailLog;

// marketplace.ts
export const appTemplates = _schema.appTemplates as typeof PgSchema.appTemplates;

// settings.ts
export const platformSettings = _schema.platformSettings as typeof PgSchema.platformSettings;

// metrics.ts
export const nodeMetrics = _schema.nodeMetrics as typeof PgSchema.nodeMetrics;
export const nodeMetricsRelations = _schema.nodeMetricsRelations;

// notifications.ts
export const notifications = _schema.notifications as typeof PgSchema.notifications;
export const notificationsRelations = _schema.notificationsRelations;

// api-keys.ts
export const apiKeys = _schema.apiKeys as typeof PgSchema.apiKeys;
export const apiKeysRelations = _schema.apiKeysRelations;

// --- Helper exports ---
export { insertReturning, updateReturning, deleteReturning, upsert, upsertIgnore, countSql } from './helpers.js';
export { getDialect } from './config.js';

// --- Re-export drizzle-orm operators so consumers use the same instance ---
export { eq, and, or, not, like, ilike, isNull, isNotNull, inArray, notInArray, between, sql, asc, desc, gte, lte, gt, lt } from 'drizzle-orm';
