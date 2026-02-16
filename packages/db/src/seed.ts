import { sql as drizzleSql } from 'drizzle-orm';
import { getDialect, getConnectionString } from './config.js';

/**
 * Database seeder — inserts default/initial data that new releases may require.
 *
 * Seeders are IDEMPOTENT: they use upsertIgnore (INSERT ... ON CONFLICT DO NOTHING
 * for PG/SQLite, INSERT IGNORE for MySQL) so they can safely be re-run.
 */

interface SeederFn {
  version: string;
  description: string;
  run: (db: any, schema: any, dialect: string) => Promise<void>;
}

/** Insert or ignore conflicts — works across all three dialects */
async function insertIgnore(db: any, table: any, values: Record<string, unknown>, target: any, dialect: string) {
  if (dialect === 'mysql') {
    await db.insert(table).values(values).onDuplicateKeyUpdate({ set: { id: drizzleSql`id` } });
  } else {
    await db.insert(table).values(values).onConflictDoNothing({ target });
  }
}

const seeders: SeederFn[] = [
  {
    version: '0.1.0',
    description: 'Initial default email templates',
    run: async (db, schema, dialect) => {
      const defaultTemplates = [
        {
          slug: 'welcome',
          subject: 'Welcome to {{platformName}}',
          bodyHtml: '<h1>Welcome, {{userName}}!</h1><p>Your account has been created on {{platformName}}.</p>',
          variables: { platformName: 'string', userName: 'string' },
          enabled: true,
        },
        {
          slug: 'password-reset',
          subject: 'Reset your password',
          bodyHtml: '<h1>Password Reset</h1><p>Click the link below to reset your password:</p><p><a href="{{resetUrl}}">Reset Password</a></p><p>This link expires in 1 hour.</p>',
          variables: { resetUrl: 'string', userName: 'string' },
          enabled: true,
        },
        {
          slug: 'invite',
          subject: 'You\'ve been invited to {{accountName}}',
          bodyHtml: '<h1>You\'re Invited!</h1><p>{{inviterName}} has invited you to join {{accountName}} on {{platformName}}.</p><p><a href="{{inviteUrl}}">Accept Invitation</a></p>',
          variables: { inviterName: 'string', accountName: 'string', platformName: 'string', inviteUrl: 'string' },
          enabled: true,
        },
        {
          slug: 'deploy-success',
          subject: 'Deployment successful: {{serviceName}}',
          bodyHtml: '<h1>Deployment Succeeded</h1><p>Your service <strong>{{serviceName}}</strong> has been deployed successfully.</p><p>Image: {{imageTag}}</p>',
          variables: { serviceName: 'string', imageTag: 'string' },
          enabled: true,
        },
        {
          slug: 'deploy-failed',
          subject: 'Deployment failed: {{serviceName}}',
          bodyHtml: '<h1>Deployment Failed</h1><p>The deployment of <strong>{{serviceName}}</strong> has failed.</p><p>Error: {{errorMessage}}</p><p>Check the deployment logs for more details.</p>',
          variables: { serviceName: 'string', errorMessage: 'string' },
          enabled: true,
        },
        {
          slug: 'domain-expiry',
          subject: 'Domain expiring soon: {{domain}}',
          bodyHtml: '<h1>Domain Expiry Warning</h1><p>Your domain <strong>{{domain}}</strong> expires on {{expiryDate}}.</p><p><a href="{{renewUrl}}">Renew Now</a></p>',
          variables: { domain: 'string', expiryDate: 'string', renewUrl: 'string' },
          enabled: true,
        },
        {
          slug: 'payment-failed',
          subject: 'Payment failed for your subscription',
          bodyHtml: '<h1>Payment Failed</h1><p>We were unable to process the payment for your {{planName}} subscription.</p><p>Please update your payment method to avoid service interruption.</p><p><a href="{{billingUrl}}">Update Payment</a></p>',
          variables: { planName: 'string', billingUrl: 'string' },
          enabled: true,
        },
        {
          slug: 'service-down',
          subject: 'Service alert: {{serviceName}} is down',
          bodyHtml: '<h1>Service Down</h1><p>Your service <strong>{{serviceName}}</strong> has no running containers.</p><p>Last status: {{lastStatus}}</p><p><a href="{{dashboardUrl}}">View Dashboard</a></p>',
          variables: { serviceName: 'string', lastStatus: 'string', dashboardUrl: 'string' },
          enabled: true,
        },
      ];

      for (const tpl of defaultTemplates) {
        await insertIgnore(db, schema.emailTemplates, {
          slug: tpl.slug,
          subject: tpl.subject,
          bodyHtml: tpl.bodyHtml,
          variables: tpl.variables,
          accountId: null,
          enabled: tpl.enabled,
        }, schema.emailTemplates.slug, dialect);
      }
    },
  },
  {
    version: '0.1.0',
    description: 'Default platform settings',
    run: async (db, schema, dialect) => {
      const defaults = [
        { key: 'platform:name', value: 'Fleet' },
        { key: 'platform:version', value: '0.1.0' },
        { key: 'platform:registrationEnabled', value: true },
        { key: 'platform:defaultPlan', value: null },
        { key: 'email:provider', value: 'smtp' },
      ];

      for (const setting of defaults) {
        await insertIgnore(db, schema.platformSettings, {
          key: setting.key,
          value: setting.value,
        }, schema.platformSettings.key, dialect);
      }
    },
  },
];

/** DDL for the seeder tracking table — dialect-specific */
function createTrackingTableSql(dialect: string) {
  if (dialect === 'mysql') {
    return drizzleSql`
      CREATE TABLE IF NOT EXISTS fleet_seeders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version VARCHAR(255) NOT NULL,
        description VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_seeder (version, description)
      )
    `;
  }
  if (dialect === 'sqlite') {
    return drizzleSql`
      CREATE TABLE IF NOT EXISTS fleet_seeders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        description TEXT NOT NULL,
        executed_at TEXT DEFAULT (datetime('now')),
        UNIQUE(version, description)
      )
    `;
  }
  // PG
  return drizzleSql`
    CREATE TABLE IF NOT EXISTS fleet_seeders (
      id SERIAL PRIMARY KEY,
      version VARCHAR NOT NULL,
      description VARCHAR NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(version, description)
    )
  `;
}

/**
 * Run all seeders. Each is idempotent.
 * Returns the number of seeders executed.
 */
export async function runSeeders(connectionString?: string): Promise<{ executed: number }> {
  const dialect = getDialect();
  const url = connectionString ?? getConnectionString();

  if (dialect === 'pg') {
    return runPgSeeders(url);
  } else if (dialect === 'mysql') {
    return runMysqlSeeders(url);
  } else {
    return runSqliteSeeders(url);
  }
}

async function runPgSeeders(url: string): Promise<{ executed: number }> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const schema = await import('./dialects/pg/schema/index.js');

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    await db.execute(createTrackingTableSql('pg'));
    return await executeSeederLoop(db, schema, 'pg');
  } finally {
    await client.end();
  }
}

async function runMysqlSeeders(url: string): Promise<{ executed: number }> {
  const mysql = await import('mysql2/promise');
  const { drizzle } = await import('drizzle-orm/mysql2');
  const schema = await import('./dialects/mysql/schema/index.js');

  const pool = mysql.createPool(url);
  const db = drizzle(pool, { schema, mode: 'default' });

  try {
    await db.execute(createTrackingTableSql('mysql'));
    return await executeSeederLoop(db, schema, 'mysql');
  } finally {
    await pool.end();
  }
}

async function runSqliteSeeders(path: string): Promise<{ executed: number }> {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./dialects/sqlite/schema/index.js');

  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  try {
    db.run(createTrackingTableSql('sqlite'));
    return await executeSeederLoop(db, schema, 'sqlite');
  } finally {
    sqlite.close();
  }
}

async function executeSeederLoop(db: any, schema: any, dialect: string): Promise<{ executed: number }> {
  let executed = 0;

  for (const seeder of seeders) {
    // Check if already run
    const existing = await db.execute(
      drizzleSql`SELECT id FROM fleet_seeders WHERE version = ${seeder.version} AND description = ${seeder.description}`,
    );

    const rows = dialect === 'mysql' ? (existing as any)[0] : existing;
    if (rows && rows.length > 0) {
      continue;
    }

    await seeder.run(db, schema, dialect);

    await db.execute(
      drizzleSql`INSERT INTO fleet_seeders (version, description) VALUES (${seeder.version}, ${seeder.description})`,
    );

    executed++;
  }

  return { executed };
}
