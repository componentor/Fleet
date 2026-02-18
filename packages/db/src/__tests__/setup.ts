process.env['DB_DIALECT'] = 'sqlite';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../dialects/sqlite/schema/index';
import { _setDb } from '../helpers';

const sqlite = new Database(':memory:');

// Enable WAL mode for better concurrency (not strictly needed for tests, but mirrors prod)
sqlite.pragma('journal_mode = WAL');
// Enable foreign keys
sqlite.pragma('foreign_keys = ON');

// --- Create all tables via raw DDL (order matters for FK references) ---

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
    scheduled_deletion_at INTEGER,
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
    security_changed_at INTEGER,
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
    github_webhook_id INTEGER,
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
    source_type TEXT,
    source_path TEXT,
    stack_id TEXT,
    stopped_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    deleted_at INTEGER
  );

  CREATE INDEX idx_services_github_autodeploy ON services(github_repo, github_branch, auto_deploy);

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
    stripe_payment_id TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE domain_tld_pricing (
    id TEXT PRIMARY KEY,
    tld TEXT NOT NULL UNIQUE,
    provider_registration_price INTEGER NOT NULL,
    provider_renewal_price INTEGER NOT NULL,
    markup_type TEXT NOT NULL DEFAULT 'percentage',
    markup_value INTEGER NOT NULL DEFAULT 20,
    sell_registration_price INTEGER NOT NULL,
    sell_renewal_price INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
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
    stripe_subscription_id TEXT UNIQUE,
    stripe_customer_id TEXT,
    billing_cycle TEXT DEFAULT 'monthly',
    status TEXT DEFAULT 'active',
    trial_ends_at INTEGER,
    current_period_start INTEGER,
    current_period_end INTEGER,
    cancelled_at INTEGER,
    past_due_since INTEGER,
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

export const db = drizzle(sqlite, { schema });

// Wire helpers to use this test database
_setDb(db);

export { schema };

/**
 * All table names in reverse-FK-safe deletion order.
 * Child/dependent tables come first so FK constraints are not violated.
 */
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
  'domain_tld_pricing',
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

/** Truncate all tables (in FK-safe order) for a clean slate between tests. */
export function resetDb(): void {
  for (const table of allTableNames) {
    sqlite.exec(`DELETE FROM "${table}"`);
  }
}
