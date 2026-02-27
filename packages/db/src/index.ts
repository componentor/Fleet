import { getDialect } from './config';
import { _setDb } from './helpers';

// PG types used as the compile-time contract for all dialects.
// At runtime, the actual objects come from the active dialect.
import type * as PgSchema from './dialects/pg/schema/index';
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
export const domainTldPricing = _schema.domainTldPricing as typeof PgSchema.domainTldPricing;
export const sharedDomains = _schema.sharedDomains as typeof PgSchema.sharedDomains;
export const subdomainClaims = _schema.subdomainClaims as typeof PgSchema.subdomainClaims;
export const sharedDomainsRelations = _schema.sharedDomainsRelations;
export const subdomainClaimsRelations = _schema.subdomainClaimsRelations;

// nodes.ts
export const nodes = _schema.nodes as typeof PgSchema.nodes;
export const nodesRelations = _schema.nodesRelations;

// billing.ts
export const billingPlans = _schema.billingPlans as typeof PgSchema.billingPlans;
export const subscriptions = _schema.subscriptions as typeof PgSchema.subscriptions;
export const usageRecords = _schema.usageRecords as typeof PgSchema.usageRecords;
export const pricingConfig = _schema.pricingConfig as typeof PgSchema.pricingConfig;
export const locationMultipliers = _schema.locationMultipliers as typeof PgSchema.locationMultipliers;
export const billingConfig = _schema.billingConfig as typeof PgSchema.billingConfig;
export const resourceLimits = _schema.resourceLimits as typeof PgSchema.resourceLimits;
export const accountBillingOverrides = _schema.accountBillingOverrides as typeof PgSchema.accountBillingOverrides;
export const billingPlansRelations = _schema.billingPlansRelations;
export const subscriptionsRelations = _schema.subscriptionsRelations;
export const usageRecordsRelations = _schema.usageRecordsRelations;
export const resourceLimitsRelations = _schema.resourceLimitsRelations;
export const accountBillingOverridesRelations = _schema.accountBillingOverridesRelations;

// ssh-keys.ts
export const sshKeys = _schema.sshKeys as typeof PgSchema.sshKeys;
export const sshAccessRules = _schema.sshAccessRules as typeof PgSchema.sshAccessRules;
export const sshKeysRelations = _schema.sshKeysRelations;
export const sshAccessRulesRelations = _schema.sshAccessRulesRelations;

// audit-log.ts
export const auditLog = _schema.auditLog as typeof PgSchema.auditLog;
export const auditLogRelations = _schema.auditLogRelations;

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

// status-page.ts
export const statusPosts = _schema.statusPosts as typeof PgSchema.statusPosts;
export const statusPostTranslations = _schema.statusPostTranslations as typeof PgSchema.statusPostTranslations;
export const uptimeSnapshots = _schema.uptimeSnapshots as typeof PgSchema.uptimeSnapshots;
export const statusPostsRelations = _schema.statusPostsRelations;
export const statusPostTranslationsRelations = _schema.statusPostTranslationsRelations;

// metrics.ts
export const nodeMetrics = _schema.nodeMetrics as typeof PgSchema.nodeMetrics;
export const nodeMetricsRelations = _schema.nodeMetricsRelations;

// notifications.ts
export const notifications = _schema.notifications as typeof PgSchema.notifications;
export const notificationsRelations = _schema.notificationsRelations;

// api-keys.ts
export const apiKeys = _schema.apiKeys as typeof PgSchema.apiKeys;
export const apiKeysRelations = _schema.apiKeysRelations;

// errors.ts
export const errorLog = _schema.errorLog as typeof PgSchema.errorLog;

// log-archives.ts
export const logArchives = _schema.logArchives as typeof PgSchema.logArchives;

// webhook_events (from billing.ts)
export const webhookEvents = _schema.webhookEvents as typeof PgSchema.webhookEvents;

// reseller tables (from billing.ts)
export const resellerConfig = _schema.resellerConfig as typeof PgSchema.resellerConfig;
export const resellerAccounts = _schema.resellerAccounts as typeof PgSchema.resellerAccounts;
export const resellerApplications = _schema.resellerApplications as typeof PgSchema.resellerApplications;
export const resellerAccountsRelations = _schema.resellerAccountsRelations;
export const resellerApplicationsRelations = _schema.resellerApplicationsRelations;

// storage.ts
export const storageClusters = _schema.storageClusters as typeof PgSchema.storageClusters;
export const storageNodes = _schema.storageNodes as typeof PgSchema.storageNodes;
export const storageVolumes = _schema.storageVolumes as typeof PgSchema.storageVolumes;
export const storageMigrations = _schema.storageMigrations as typeof PgSchema.storageMigrations;
export const storageClustersRelations = _schema.storageClustersRelations;
export const storageNodesRelations = _schema.storageNodesRelations;
export const storageVolumesRelations = _schema.storageVolumesRelations;
export const storageMigrationsRelations = _schema.storageMigrationsRelations;

// registry-credentials.ts
export const registryCredentials = _schema.registryCredentials as typeof PgSchema.registryCredentials;
export const registryCredentialsRelations = _schema.registryCredentialsRelations;

// admin-roles.ts
export const adminRoles = _schema.adminRoles as typeof PgSchema.adminRoles;

// support.ts
export const supportTickets = _schema.supportTickets as typeof PgSchema.supportTickets;
export const supportTicketMessages = _schema.supportTicketMessages as typeof PgSchema.supportTicketMessages;
export const supportTicketsRelations = _schema.supportTicketsRelations;
export const supportTicketMessagesRelations = _schema.supportTicketMessagesRelations;

// self-healing.ts
export const selfHealingJobs = _schema.selfHealingJobs as typeof PgSchema.selfHealingJobs;
export const selfHealingJobsRelations = _schema.selfHealingJobsRelations;

// --- Helper exports ---
export { insertReturning, updateReturning, deleteReturning, upsert, upsertIgnore, countSql, safeTransaction } from './helpers';
export { getDialect } from './config';

// --- Re-export drizzle-orm operators so consumers use the same instance ---
export { eq, and, or, not, like, ilike, isNull, isNotNull, inArray, notInArray, between, sql, asc, desc, gte, lte, gt, lt } from 'drizzle-orm';
