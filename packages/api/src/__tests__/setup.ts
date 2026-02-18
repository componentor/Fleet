// ── Environment variables MUST be set BEFORE any imports ──
process.env['DB_DIALECT'] = 'sqlite';
process.env['JWT_SECRET'] = 'test-secret-key-for-jwt-signing-minimum-32-chars';
process.env['REDIS_URL'] = 'redis://localhost:6379';

import { vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as sqliteSchema from '../../../db/src/dialects/sqlite/schema/index.js';
import { _setDb } from '../../../db/src/helpers.js';
import * as drizzleOrm from 'drizzle-orm';

// ── Create in-memory SQLite DB ──
const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    name TEXT,
    slug TEXT UNIQUE,
    parent_id TEXT,
    path TEXT,
    depth INTEGER DEFAULT 0,
    trust_revocable INTEGER DEFAULT 0,
    stripe_customer_id TEXT,
    stripe_connect_account_id TEXT,
    plan TEXT,
    status TEXT DEFAULT 'active',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    deleted_at INTEGER
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT,
    avatar_url TEXT,
    is_super INTEGER DEFAULT 0,
    email_verified INTEGER DEFAULT 0,
    email_verify_token TEXT,
    email_verify_expires INTEGER,
    password_reset_token TEXT,
    password_reset_expires INTEGER,
    two_factor_enabled INTEGER DEFAULT 0,
    two_factor_secret TEXT,
    two_factor_backup_codes TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    deleted_at INTEGER
  );

  CREATE TABLE user_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX user_accounts_user_account_idx ON user_accounts(user_id, account_id);

  CREATE TABLE oauth_providers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    access_token TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX oauth_provider_user_idx ON oauth_providers(provider, provider_user_id);

  CREATE TABLE services (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    image TEXT NOT NULL,
    replicas INTEGER DEFAULT 1,
    env TEXT DEFAULT '{}',
    ports TEXT DEFAULT '[]',
    volumes TEXT DEFAULT '[]',
    docker_service_id TEXT,
    github_repo TEXT,
    github_branch TEXT,
    auto_deploy INTEGER DEFAULT 0,
    domain TEXT,
    ssl_enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'stopped',
    node_constraint TEXT,
    placement_constraints TEXT DEFAULT '[]',
    update_parallelism INTEGER DEFAULT 1,
    update_delay TEXT DEFAULT '10s',
    rollback_on_failure INTEGER DEFAULT 1,
    health_check TEXT,
    cpu_limit INTEGER,
    memory_limit INTEGER,
    cpu_reservation INTEGER,
    memory_reservation INTEGER,
    stopped_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    deleted_at INTEGER
  );

  CREATE TABLE deployments (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    commit_sha TEXT,
    status TEXT DEFAULT 'pending',
    log TEXT DEFAULT '',
    image_tag TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE dns_zones (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    domain TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    nameservers TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE dns_records (
    id TEXT PRIMARY KEY,
    zone_id TEXT NOT NULL REFERENCES dns_zones(id),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    ttl INTEGER DEFAULT 3600,
    priority INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE domain_registrars (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    api_key TEXT NOT NULL,
    api_secret TEXT,
    config TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE domain_registrations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    registrar_id TEXT NOT NULL REFERENCES domain_registrars(id),
    domain TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    registered_at INTEGER,
    expires_at INTEGER,
    auto_renew INTEGER DEFAULT 1,
    registrar_domain_id TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    docker_node_id TEXT,
    role TEXT DEFAULT 'worker',
    status TEXT DEFAULT 'active',
    labels TEXT DEFAULT '{}',
    location TEXT,
    nfs_server INTEGER DEFAULT 0,
    last_heartbeat INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE billing_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    is_free INTEGER DEFAULT 0,
    visible INTEGER DEFAULT 1,
    cpu_limit INTEGER NOT NULL,
    memory_limit INTEGER NOT NULL,
    container_limit INTEGER NOT NULL,
    storage_limit INTEGER NOT NULL,
    bandwidth_limit INTEGER,
    price_cents INTEGER NOT NULL,
    stripe_product_id TEXT,
    stripe_price_ids TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES billing_plans(id),
    billing_model TEXT DEFAULT 'fixed',
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,
    billing_cycle TEXT DEFAULT 'monthly',
    status TEXT DEFAULT 'active',
    trial_ends_at INTEGER,
    current_period_start INTEGER,
    current_period_end INTEGER,
    cancelled_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE billing_config (
    id TEXT PRIMARY KEY,
    billing_model TEXT DEFAULT 'fixed' NOT NULL,
    allow_user_choice INTEGER DEFAULT 0,
    allowed_cycles TEXT DEFAULT '["monthly","yearly"]',
    cycle_discounts TEXT DEFAULT '{}',
    trial_days INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE usage_records (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    period_start INTEGER,
    period_end INTEGER,
    containers INTEGER DEFAULT 0,
    cpu_seconds INTEGER DEFAULT 0,
    memory_mb_hours INTEGER DEFAULT 0,
    storage_gb INTEGER DEFAULT 0,
    bandwidth_gb INTEGER DEFAULT 0,
    recorded_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE pricing_config (
    id TEXT PRIMARY KEY,
    cpu_cents_per_hour INTEGER DEFAULT 0,
    memory_cents_per_gb_hour INTEGER DEFAULT 0,
    storage_cents_per_gb_month INTEGER DEFAULT 0,
    bandwidth_cents_per_gb INTEGER DEFAULT 0,
    container_cents_per_hour INTEGER DEFAULT 0,
    domain_markup_percent INTEGER DEFAULT 0,
    backup_storage_cents_per_gb INTEGER DEFAULT 0,
    location_pricing_enabled INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE location_multipliers (
    id TEXT PRIMARY KEY,
    location_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    multiplier INTEGER DEFAULT 100,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE resource_limits (
    id TEXT PRIMARY KEY,
    account_id TEXT REFERENCES accounts(id),
    max_cpu_per_container INTEGER,
    max_memory_per_container INTEGER,
    max_replicas INTEGER,
    max_containers INTEGER,
    max_storage_gb INTEGER,
    max_bandwidth_gb INTEGER,
    max_nfs_storage_gb INTEGER,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE account_billing_overrides (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
    discount_percent INTEGER DEFAULT 0,
    custom_price_cents INTEGER,
    notes TEXT,
    cpu_cents_per_hour_override INTEGER,
    memory_cents_per_gb_hour_override INTEGER,
    storage_cents_per_gb_month_override INTEGER,
    bandwidth_cents_per_gb_override INTEGER,
    container_cents_per_hour_override INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE ssh_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE ssh_access_rules (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id),
    allowed_ips TEXT DEFAULT '[]',
    enabled INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    ip_address TEXT,
    details TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE backups (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    service_id TEXT REFERENCES services(id),
    type TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'pending',
    storage_path TEXT,
    storage_backend TEXT DEFAULT 'nfs',
    size_bytes INTEGER DEFAULT 0,
    contents TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER
  );

  CREATE TABLE backup_schedules (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    service_id TEXT REFERENCES services(id),
    cron TEXT NOT NULL,
    retention_days INTEGER DEFAULT 30,
    retention_count INTEGER DEFAULT 10,
    storage_backend TEXT DEFAULT 'nfs',
    enabled INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    last_run_at INTEGER
  );

  CREATE TABLE email_templates (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    variables TEXT DEFAULT '[]',
    account_id TEXT REFERENCES accounts(id),
    enabled INTEGER DEFAULT 1,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE email_log (
    id TEXT PRIMARY KEY,
    template_slug TEXT NOT NULL,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    status TEXT DEFAULT 'queued',
    sent_at INTEGER,
    error TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE app_templates (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon_url TEXT,
    category TEXT DEFAULT 'other',
    compose_template TEXT NOT NULL,
    variables TEXT DEFAULT '[]',
    is_builtin INTEGER DEFAULT 0,
    account_id TEXT REFERENCES accounts(id),
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE platform_settings (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE node_metrics (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id),
    hostname TEXT NOT NULL,
    cpu_count INTEGER NOT NULL,
    mem_total INTEGER NOT NULL,
    mem_used INTEGER NOT NULL,
    mem_free INTEGER NOT NULL,
    container_count INTEGER NOT NULL,
    recorded_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    scopes TEXT DEFAULT '["*"]',
    last_used_at INTEGER,
    expires_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE error_log (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    method TEXT,
    path TEXT,
    status_code INTEGER,
    user_id TEXT,
    ip TEXT,
    user_agent TEXT,
    metadata TEXT,
    resolved INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY,
    stripe_event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    processed_at INTEGER DEFAULT (unixepoch()),
    payload TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

// Create drizzle instance with schema
const testDb = drizzle(sqlite, { schema: sqliteSchema });

// Patch transaction() to support async callbacks (production uses PG/MySQL which support async,
// but better-sqlite3 is synchronous and rejects Promise-returning callbacks).
// For tests, we execute the callback directly using testDb as the tx context.
const originalTransaction = testDb.transaction.bind(testDb);
(testDb as any).transaction = async function (cb: (tx: any) => Promise<any>) {
  return cb(testDb);
};

// Wire up the helpers to use this test database
_setDb(testDb);

// ── Mock @hono/node-ws (not available in test env) ──
vi.mock('@hono/node-ws', () => ({
  createNodeWebSocket: vi.fn().mockReturnValue({
    upgradeWebSocket: vi.fn().mockImplementation(() => {
      // Return a no-op middleware for WebSocket routes in tests
      return vi.fn().mockImplementation(async (c: any, next: any) => next());
    }),
    injectWebSocket: vi.fn(),
    wss: {},
  }),
}));

// ── Mock ioredis ──
vi.mock('ioredis', () => {
  const Redis = vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
  }));
  return { default: Redis, Redis };
});

// ── Mock argon2 ──
vi.mock('argon2', () => ({
  hash: vi.fn().mockImplementation(async (password: string) => `hashed:${password}`),
  verify: vi.fn().mockImplementation(async (hash: string, password: string) => hash === `hashed:${password}`),
}));

// ── Mock Docker service ──
vi.mock('../services/docker.service.js', () => ({
  dockerService: {
    createService: vi.fn().mockResolvedValue({ id: 'docker-svc-123' }),
    updateService: vi.fn().mockResolvedValue(undefined),
    removeService: vi.fn().mockResolvedValue(undefined),
    inspectService: vi.fn().mockResolvedValue({
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    }),
    getServiceTasks: vi.fn().mockResolvedValue([]),
    getServiceLogs: vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('test log');
      },
    }),
    listNodes: vi.fn().mockResolvedValue([]),
    inspectNode: vi.fn().mockResolvedValue({}),
    updateNode: vi.fn().mockResolvedValue(undefined),
    drainNode: vi.fn().mockResolvedValue(undefined),
    activateNode: vi.fn().mockResolvedValue(undefined),
    removeNode: vi.fn().mockResolvedValue(undefined),
    getSwarmInfo: vi.fn().mockResolvedValue({
      ID: 'swarm-1',
      CreatedAt: new Date().toISOString(),
      Version: { Index: 1 },
    }),
    getSwarmJoinToken: vi.fn().mockResolvedValue({
      worker: 'worker-token',
      manager: 'manager-token',
    }),
    listServices: vi.fn().mockResolvedValue([]),
    scaleService: vi.fn().mockResolvedValue(undefined),
    createNetwork: vi.fn().mockResolvedValue('network-id'),
    removeNetwork: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock DNS service ──
const mockDnsProvider = {
  name: 'powerdns',
  createZone: vi.fn().mockResolvedValue(undefined),
  deleteZone: vi.fn().mockResolvedValue(undefined),
  createRecord: vi.fn().mockResolvedValue(undefined),
  updateRecord: vi.fn().mockResolvedValue(undefined),
  deleteRecord: vi.fn().mockResolvedValue(undefined),
  verifyDomain: vi.fn().mockResolvedValue(true),
};
vi.mock('../services/dns.service.js', () => {
  const PowerDnsProvider = vi.fn().mockImplementation(() => mockDnsProvider);
  return {
    PowerDnsProvider,
    dnsService: mockDnsProvider,
  };
});

// ── Mock Cloudflare DNS provider ──
vi.mock('../services/cloudflare-dns-provider.js', () => {
  const CloudflareDnsProvider = vi.fn().mockImplementation(() => ({
    name: 'cloudflare',
    createZone: vi.fn().mockResolvedValue(undefined),
    deleteZone: vi.fn().mockResolvedValue(undefined),
    createRecord: vi.fn().mockResolvedValue(undefined),
    updateRecord: vi.fn().mockResolvedValue(undefined),
    deleteRecord: vi.fn().mockResolvedValue(undefined),
    verifyDomain: vi.fn().mockResolvedValue(true),
  }));
  return { CloudflareDnsProvider };
});

// ── Mock DNS provider manager ──
vi.mock('../services/dns-provider-manager.js', () => ({
  DnsProviderManager: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    createZone: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
    deleteZone: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
    createRecord: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
    updateRecord: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
    deleteRecord: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
  })),
  dnsManager: {
    register: vi.fn(),
    createZone: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
    deleteZone: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
    createRecord: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
    updateRecord: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
    deleteRecord: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
  },
}));

// ── Mock email service ──
vi.mock('../services/email.service.js', () => ({
  emailService: {
    sendTemplateEmail: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
    sendEmail: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
    getDefaultTemplates: vi.fn().mockReturnValue({
      'welcome': {
        subject: 'Welcome to {{platformName}}',
        bodyHtml: '<h1>Welcome, {{userName}}!</h1>',
        variables: ['userName', 'platformName', 'loginUrl'],
      },
      'password-reset': {
        subject: 'Reset your password',
        bodyHtml: '<p>Reset: {{resetUrl}}</p>',
        variables: ['userName', 'resetUrl', 'expiresIn'],
      },
      'invite': {
        subject: 'You have been invited to {{accountName}}',
        bodyHtml: '<p>Invite: {{inviteUrl}}</p>',
        variables: ['userName', 'accountName', 'platformName', 'inviteUrl'],
      },
      'deployment-success': {
        subject: 'Deployment succeeded: {{serviceName}}',
        bodyHtml: '<p>Success</p>',
        variables: ['serviceName', 'deploymentId', 'timestamp'],
      },
      'deployment-failed': {
        subject: 'Deployment failed: {{serviceName}}',
        bodyHtml: '<p>Failed</p>',
        variables: ['serviceName', 'deploymentId', 'errorMessage'],
      },
      'domain-expiry': {
        subject: 'Domain expiring soon: {{domain}}',
        bodyHtml: '<p>Expiring</p>',
        variables: ['domain', 'expiryDate', 'renewUrl'],
      },
    }),
    getProvider: vi.fn().mockReturnValue({
      name: 'test',
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
    }),
    renderTemplate: vi.fn().mockResolvedValue({
      subject: 'Test Subject',
      html: '<p>Test Body</p>',
    }),
    resetProvider: vi.fn(),
  },
}));

// ── Mock update service ──
vi.mock('../services/update.service.js', () => ({
  updateService: {
    getNotification: vi.fn().mockReturnValue({ available: false, latest: null }),
    getState: vi.fn().mockReturnValue({
      status: 'idle',
      currentVersion: '0.1.0',
      targetVersion: null,
      log: '',
      startedAt: null,
      finishedAt: null,
      previousImageTags: {},
      preUpdateBackupId: null,
    }),
    startPeriodicCheck: vi.fn(),
    stopPeriodicCheck: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue({
      available: false,
      current: '0.1.0',
      latest: null,
      checkedAt: new Date().toISOString(),
    }),
    listReleases: vi.fn().mockResolvedValue([]),
    performUpdate: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockReturnValue(() => {}),
  },
}));

// ── Mock backup service ──
vi.mock('../services/backup.service.js', () => ({
  backupService: {
    createBackup: vi.fn().mockResolvedValue({ id: 'backup-1' }),
    getBackup: vi.fn().mockResolvedValue(null),
    listBackups: vi.fn().mockResolvedValue([]),
    deleteBackup: vi.fn().mockResolvedValue(undefined),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    createSchedule: vi.fn().mockResolvedValue({ id: 'schedule-1' }),
    listSchedules: vi.fn().mockResolvedValue([]),
    updateSchedule: vi.fn().mockResolvedValue({}),
    deleteSchedule: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock Stripe service ──
vi.mock('../services/stripe.service.js', () => ({
  stripeService: {
    createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test' }),
    createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
    createFlexibleCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
    createPortalSession: vi.fn().mockResolvedValue({ url: 'https://portal.stripe.com/test' }),
    getSubscription: vi.fn().mockResolvedValue(null),
    cancelSubscription: vi.fn().mockResolvedValue(undefined),
    cancelSubscriptionAtPeriodEnd: vi.fn().mockResolvedValue(undefined),
    reportUsage: vi.fn().mockResolvedValue(undefined),
    listInvoices: vi.fn().mockResolvedValue({ data: [] }),
    createProduct: vi.fn().mockResolvedValue({ id: 'prod_test' }),
    updateProduct: vi.fn().mockResolvedValue({ id: 'prod_test' }),
    createPrice: vi.fn().mockResolvedValue({ id: 'price_test' }),
    listPrices: vi.fn().mockResolvedValue({ data: [] }),
    updateSubscription: vi.fn().mockResolvedValue(undefined),
    createDomainCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/domain' }),
    constructWebhookEvent: vi.fn(),
  },
}));

// ── Mock GitHub service ──
vi.mock('../services/github.service.js', () => ({
  githubService: {
    getRepoInfo: vi.fn().mockResolvedValue(null),
    listBranches: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue(undefined),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
  },
}));

// ── Mock build service ──
vi.mock('../services/build.service.js', () => ({
  buildService: {
    buildAndDeploy: vi.fn().mockResolvedValue({ deploymentId: 'deploy-1' }),
  },
}));

// ── Mock SSH service ──
vi.mock('../services/ssh.service.js', () => ({
  sshService: {
    parsePublicKey: vi.fn().mockReturnValue({ fingerprint: 'SHA256:test-fingerprint' }),
  },
}));

// ── Mock NFS service ──
vi.mock('../services/nfs.service.js', () => ({
  nfsService: {
    createExport: vi.fn().mockResolvedValue(undefined),
    removeExport: vi.fn().mockResolvedValue(undefined),
    listExports: vi.fn().mockResolvedValue([]),
  },
}));

// ── Mock Cloudflare service ──
vi.mock('../services/cloudflare.service.js', () => ({
  cloudflareService: {
    createZone: vi.fn().mockResolvedValue(undefined),
    deleteZone: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock registrar service ──
vi.mock('../services/registrar.service.js', () => ({
  registrarService: {
    searchDomain: vi.fn().mockResolvedValue({ available: true, price: 1200 }),
    registerDomain: vi.fn().mockResolvedValue({ domainId: 'domain-1' }),
    renewDomain: vi.fn().mockResolvedValue(undefined),
    transferDomain: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock stripe-sync service ──
vi.mock('../services/stripe-sync.service.js', () => ({
  stripeSyncService: {
    syncPlanToStripe: vi.fn().mockResolvedValue(undefined),
    syncAllPlans: vi.fn().mockResolvedValue({ synced: 0 }),
    ensureMeteredPrices: vi.fn().mockResolvedValue(undefined),
    createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
  },
}));

// ── Mock usage service ──
vi.mock('../services/usage.service.js', () => ({
  usageService: {
    collectUsage: vi.fn().mockResolvedValue(undefined),
    getAccountUsageSummary: vi.fn().mockResolvedValue({
      containers: 0,
      cpuHours: 0,
      memoryGbHours: 0,
      storageGb: 0,
      bandwidthGb: 0,
      estimatedCostCents: 0,
      breakdown: { cpuCents: 0, memoryCents: 0, storageCents: 0, bandwidthCents: 0, containerCents: 0 },
      periodStart: null,
      periodEnd: null,
    }),
    reportUsageToStripe: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock template service ──
vi.mock('../services/template.service.js', () => ({
  templateService: {
    getTemplates: vi.fn().mockResolvedValue([]),
    getTemplate: vi.fn().mockResolvedValue(null),
    deploy: vi.fn().mockResolvedValue({ serviceId: 'svc-1' }),
  },
}));

// ── Mock notification service ──
vi.mock('../services/notification.service.js', () => ({
  notificationService: {
    create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock scheduler service ──
vi.mock('../services/scheduler.service.js', () => ({
  schedulerService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn(),
    onScheduleCreated: vi.fn().mockResolvedValue(undefined),
    onScheduleUpdated: vi.fn().mockResolvedValue(undefined),
    onScheduleDeleted: vi.fn(),
  },
}));

// ── Mock nodemailer ──
vi.mock('nodemailer', () => ({
  createTransport: vi.fn().mockReturnValue({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
  }),
}));

// ── Helper functions for insertReturning/updateReturning/deleteReturning ──
const insertReturning = async (table: any, values: Record<string, unknown>): Promise<any[]> => {
  return testDb.insert(table).values(values).returning() as Promise<any[]>;
};

const updateReturning = async (
  table: any,
  set: Record<string, unknown>,
  condition: any,
): Promise<any[]> => {
  return testDb.update(table).set(set).where(condition).returning() as Promise<any[]>;
};

const deleteReturning = async (table: any, condition: any): Promise<any[]> => {
  return testDb.delete(table).where(condition).returning() as Promise<any[]>;
};

const upsert = async (
  table: any,
  values: Record<string, unknown>,
  target: any,
  updateSet: Record<string, unknown>,
): Promise<void> => {
  await testDb.insert(table).values(values).onConflictDoUpdate({ target, set: updateSet });
};

const upsertIgnore = async (
  table: any,
  values: Record<string, unknown>,
  target?: any,
): Promise<void> => {
  if (target) {
    await testDb.insert(table).values(values).onConflictDoNothing({ target });
  } else {
    await testDb.insert(table).values(values).onConflictDoNothing();
  }
};

const countSql = (): any => {
  return drizzleOrm.sql`COUNT(*)`;
};

// ── Mock @fleet/db ──
vi.mock('@fleet/db', () => ({
  db: testDb,

  // Table objects
  accounts: sqliteSchema.accounts,
  accountsRelations: sqliteSchema.accountsRelations,
  users: sqliteSchema.users,
  userAccounts: sqliteSchema.userAccounts,
  oauthProviders: sqliteSchema.oauthProviders,
  usersRelations: sqliteSchema.usersRelations,
  userAccountsRelations: sqliteSchema.userAccountsRelations,
  oauthProvidersRelations: sqliteSchema.oauthProvidersRelations,
  services: sqliteSchema.services,
  deployments: sqliteSchema.deployments,
  servicesRelations: sqliteSchema.servicesRelations,
  deploymentsRelations: sqliteSchema.deploymentsRelations,
  dnsZones: sqliteSchema.dnsZones,
  dnsRecords: sqliteSchema.dnsRecords,
  domainRegistrars: sqliteSchema.domainRegistrars,
  domainRegistrations: sqliteSchema.domainRegistrations,
  dnsZonesRelations: sqliteSchema.dnsZonesRelations,
  dnsRecordsRelations: sqliteSchema.dnsRecordsRelations,
  domainRegistrarsRelations: sqliteSchema.domainRegistrarsRelations,
  domainRegistrationsRelations: sqliteSchema.domainRegistrationsRelations,
  nodes: sqliteSchema.nodes,
  nodesRelations: sqliteSchema.nodesRelations,
  billingPlans: (sqliteSchema as any).billingPlans,
  subscriptions: (sqliteSchema as any).subscriptions,
  usageRecords: (sqliteSchema as any).usageRecords,
  pricingConfig: (sqliteSchema as any).pricingConfig,
  locationMultipliers: (sqliteSchema as any).locationMultipliers,
  resourceLimits: (sqliteSchema as any).resourceLimits,
  accountBillingOverrides: (sqliteSchema as any).accountBillingOverrides,
  billingPlansRelations: (sqliteSchema as any).billingPlansRelations,
  subscriptionsRelations: (sqliteSchema as any).subscriptionsRelations,
  usageRecordsRelations: (sqliteSchema as any).usageRecordsRelations,
  resourceLimitsRelations: (sqliteSchema as any).resourceLimitsRelations,
  accountBillingOverridesRelations: (sqliteSchema as any).accountBillingOverridesRelations,
  billingConfig: (sqliteSchema as any).billingConfig,
  sshKeys: sqliteSchema.sshKeys,
  sshAccessRules: sqliteSchema.sshAccessRules,
  sshKeysRelations: (sqliteSchema as any).sshKeysRelations,
  sshAccessRulesRelations: (sqliteSchema as any).sshAccessRulesRelations,
  auditLog: sqliteSchema.auditLog,
  backups: (sqliteSchema as any).backups,
  backupSchedules: (sqliteSchema as any).backupSchedules,
  backupsRelations: (sqliteSchema as any).backupsRelations,
  backupSchedulesRelations: (sqliteSchema as any).backupSchedulesRelations,
  emailTemplates: sqliteSchema.emailTemplates,
  emailLog: sqliteSchema.emailLog,
  appTemplates: (sqliteSchema as any).appTemplates,
  platformSettings: (sqliteSchema as any).platformSettings,
  nodeMetrics: sqliteSchema.nodeMetrics,
  nodeMetricsRelations: sqliteSchema.nodeMetricsRelations,
  notifications: sqliteSchema.notifications,
  notificationsRelations: sqliteSchema.notificationsRelations,
  apiKeys: sqliteSchema.apiKeys,
  apiKeysRelations: sqliteSchema.apiKeysRelations,
  errorLog: (sqliteSchema as any).errorLog,
  webhookEvents: (sqliteSchema as any).webhookEvents,

  // Helpers
  insertReturning,
  updateReturning,
  deleteReturning,
  upsert,
  upsertIgnore,
  countSql,
  getDialect: () => 'sqlite',

  // Drizzle-orm operators
  eq: drizzleOrm.eq,
  and: drizzleOrm.and,
  or: drizzleOrm.or,
  not: drizzleOrm.not,
  like: drizzleOrm.like,
  ilike: drizzleOrm.ilike,
  isNull: drizzleOrm.isNull,
  isNotNull: drizzleOrm.isNotNull,
  inArray: drizzleOrm.inArray,
  notInArray: drizzleOrm.notInArray,
  between: drizzleOrm.between,
  sql: drizzleOrm.sql,
  asc: drizzleOrm.asc,
  desc: drizzleOrm.desc,
  gte: drizzleOrm.gte,
  lte: drizzleOrm.lte,
  gt: drizzleOrm.gt,
  lt: drizzleOrm.lt,
}));

// ── All table names in FK-safe deletion order ──
const allTableNames = [
  'webhook_events',
  'error_log',
  'api_keys',
  'notifications',
  'node_metrics',
  'email_log',
  'email_templates',
  'backup_schedules',
  'backups',
  'audit_log',
  'ssh_access_rules',
  'ssh_keys',
  'account_billing_overrides',
  'resource_limits',
  'billing_config',
  'location_multipliers',
  'pricing_config',
  'usage_records',
  'subscriptions',
  'billing_plans',
  'domain_registrations',
  'domain_registrars',
  'dns_records',
  'dns_zones',
  'deployments',
  'services',
  'oauth_providers',
  'user_accounts',
  'users',
  'nodes',
  'app_templates',
  'platform_settings',
  'accounts',
];

// ── resetDb function ──
export function resetDb(): void {
  for (const table of allTableNames) {
    sqlite.exec(`DELETE FROM "${table}"`);
  }
}

// ── Helper: create a JWT for testing ──
const JWT_SECRET = new TextEncoder().encode(process.env['JWT_SECRET']!);

export async function createAuthToken(user: {
  userId: string;
  email: string;
  isSuper: boolean;
}): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(JWT_SECRET);
}

// ── Helper: create a test user with account and token ──
export async function createTestUser(
  overrides: Partial<{
    email: string;
    password: string;
    name: string;
    isSuper: boolean;
    accountName: string;
  }> = {},
): Promise<{ user: any; account: any; token: string }> {
  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const userAccountId = crypto.randomUUID();
  const email = overrides.email ?? `user-${userId.slice(0, 8)}@test.com`;
  const password = overrides.password ?? 'password123';
  const name = overrides.name ?? 'Test User';
  const isSuper = overrides.isSuper ?? false;
  const slug = `test-${userId.slice(0, 8)}`;

  // Insert user
  const [user] = await testDb
    .insert(sqliteSchema.users)
    .values({
      id: userId,
      email,
      passwordHash: `hashed:${password}`,
      name,
      isSuper,
    })
    .returning();

  // Insert account
  const [account] = await testDb
    .insert(sqliteSchema.accounts)
    .values({
      id: accountId,
      name: overrides.accountName ?? `${name}'s Account`,
      slug,
      path: slug,
      depth: 0,
      status: 'active',
    })
    .returning();

  // Link user to account
  await testDb.insert(sqliteSchema.userAccounts).values({
    id: userAccountId,
    userId,
    accountId,
    role: 'owner',
  });

  // Create auth token
  const token = await createAuthToken({
    userId,
    email,
    isSuper,
  });

  return { user, account, token };
}

// ── Global hooks ──
beforeEach(() => {
  resetDb();
});
