process.env['DB_DIALECT'] = 'sqlite';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../dialects/sqlite/schema/index.js';
import { _setDb } from '../helpers.js';

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
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT,
    avatar_url TEXT,
    is_super INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE user_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    role TEXT DEFAULT 'member',
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX user_accounts_user_account_idx ON user_accounts(user_id, account_id);

  CREATE TABLE oauth_providers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    access_token TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX oauth_provider_user_idx ON oauth_providers(provider, provider_user_id);

  CREATE TABLE services (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
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
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE deployments (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id),
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
    nfs_server INTEGER DEFAULT 0,
    last_heartbeat INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE billing_plans (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    name TEXT NOT NULL,
    stripe_price_id TEXT,
    cpu_limit INTEGER NOT NULL,
    memory_limit INTEGER NOT NULL,
    container_limit INTEGER NOT NULL,
    storage_limit INTEGER NOT NULL,
    price_cents INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    plan_id TEXT NOT NULL REFERENCES billing_plans(id),
    stripe_subscription_id TEXT,
    status TEXT DEFAULT 'active',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE usage_records (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    containers INTEGER DEFAULT 0,
    cpu_seconds INTEGER DEFAULT 0,
    memory_mb_hours INTEGER DEFAULT 0,
    storage_gb INTEGER DEFAULT 0,
    recorded_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE pricing_config (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    container_fee INTEGER DEFAULT 0,
    cpu_fee INTEGER DEFAULT 0,
    memory_fee INTEGER DEFAULT 0,
    storage_fee INTEGER DEFAULT 0,
    bandwidth_fee INTEGER DEFAULT 0,
    domain_markup_percent INTEGER DEFAULT 0,
    backup_storage_fee INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX pricing_config_account_idx ON pricing_config(account_id);

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
    user_id TEXT REFERENCES users(id),
    account_id TEXT REFERENCES accounts(id),
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
    updated_at INTEGER DEFAULT (unixepoch())
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
  'email_log',
  'email_templates',
  'backup_schedules',
  'backups',
  'audit_log',
  'ssh_access_rules',
  'ssh_keys',
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

/** Truncate all tables (in FK-safe order) for a clean slate between tests. */
export function resetDb(): void {
  for (const table of allTableNames) {
    sqlite.exec(`DELETE FROM "${table}"`);
  }
}
