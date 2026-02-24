import { sql as drizzleSql } from 'drizzle-orm';
import { getDialect, getConnectionString } from './config';

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
      // Styled email template helpers (matches email.service.ts DEFAULT_TEMPLATES)
      const sH1 = 'style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827;line-height:1.3;"';
      const sSub = 'style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.5;"';
      const sP = 'style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;"';
      const sMuted = 'style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;"';
      const sLabel = 'style="margin:0 0 4px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;"';
      const seedBtn = (href: string, text: string) =>
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:8px;background-color:#4f46e5;"><a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${text}</a></td></tr></table>`;
      const seedInfoBox = (color: string, title: string) => {
        const c: Record<string, { bg: string; border: string; text: string }> = {
          green: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
          red: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
          amber: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
        };
        const s = c[color] ?? c['red']!;
        return `<div style="padding:16px 20px;background-color:${s.bg};border-radius:8px;border-left:4px solid ${s.border};margin:0 0 24px;"><p style="margin:0;font-size:14px;font-weight:600;color:${s.text};">${title}</p></div>`;
      };
      const seedMetaBox = (label: string, value: string, bg = '#f9fafb', border = '#e5e7eb', color = '#111827') =>
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td style="padding:12px 16px;background-color:${bg};border-radius:8px;border:1px solid ${border};"><p ${sLabel}>${label}</p><p style="margin:0;font-size:14px;color:${color};font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">${value}</p></td></tr></table>`;

      const defaultTemplates = [
        {
          slug: 'email-verification',
          subject: 'Verify your email address',
          bodyHtml: `<h1 ${sH1}>Verify your email</h1><p ${sSub}>Confirm your email address to get started.</p><p ${sP}>Hi <strong>{{userName}}</strong>,</p><p ${sP}>Please verify your email address by clicking the button below.</p>${seedBtn('{{verifyUrl}}', 'Verify Email Address')}<p ${sMuted}>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
          variables: { userName: 'string', verifyUrl: 'string' },
          enabled: true,
        },
        {
          slug: 'welcome',
          subject: 'Welcome to {{platformName}}',
          bodyHtml: `<h1 ${sH1}>Welcome aboard!</h1><p ${sSub}>Your account is ready to go.</p><p ${sP}>Hi <strong>{{userName}}</strong>,</p><p ${sP}>Your account on <strong>{{platformName}}</strong> has been created successfully. You can start deploying services right away.</p>${seedBtn('{{loginUrl}}', 'Go to Dashboard')}<p ${sMuted}>If you have any questions, check out the documentation or contact support.</p>`,
          variables: { platformName: 'string', userName: 'string', loginUrl: 'string' },
          enabled: true,
        },
        {
          slug: 'password-reset',
          subject: 'Reset your password',
          bodyHtml: `<h1 ${sH1}>Reset your password</h1><p ${sSub}>We received a request to reset your password.</p><p ${sP}>Hi <strong>{{userName}}</strong>,</p><p ${sP}>Click the button below to choose a new password. This link will expire in <strong>{{expiresIn}}</strong>.</p>${seedBtn('{{resetUrl}}', 'Reset Password')}<p ${sMuted}>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>`,
          variables: { resetUrl: 'string', userName: 'string', expiresIn: 'string' },
          enabled: true,
        },
        {
          slug: 'invite',
          subject: 'You have been invited to {{accountName}}',
          bodyHtml: `<h1 ${sH1}>You're invited!</h1><p ${sSub}>Join a team on {{platformName}}.</p><p ${sP}>Hi <strong>{{userName}}</strong>,</p><p ${sP}>You've been invited to join <strong>{{accountName}}</strong> on <strong>{{platformName}}</strong>. Click below to accept the invitation and get started.</p>${seedBtn('{{inviteUrl}}', 'Accept Invitation')}<p ${sMuted}>If you don't recognize this invitation, you can ignore this email.</p>`,
          variables: { userName: 'string', accountName: 'string', platformName: 'string', inviteUrl: 'string' },
          enabled: true,
        },
        {
          slug: 'deploy-success',
          subject: 'Deployment succeeded: {{serviceName}}',
          bodyHtml: `${seedInfoBox('green', 'Deployment Successful')}<p ${sP}>Your service <strong>{{serviceName}}</strong> has been deployed successfully.</p>${seedMetaBox('Image', '{{imageTag}}')}`,
          variables: { serviceName: 'string', imageTag: 'string' },
          enabled: true,
        },
        {
          slug: 'deploy-failed',
          subject: 'Deployment failed: {{serviceName}}',
          bodyHtml: `${seedInfoBox('red', 'Deployment Failed')}<p ${sP}>The deployment of <strong>{{serviceName}}</strong> has failed.</p>${seedMetaBox('Error', '{{errorMessage}}', '#fef2f2', '#fecaca', '#7f1d1d')}<p ${sMuted}>Check the deployment logs in your dashboard for more details.</p>`,
          variables: { serviceName: 'string', errorMessage: 'string' },
          enabled: true,
        },
        {
          slug: 'domain-expiry',
          subject: 'Domain expiring soon: {{domain}}',
          bodyHtml: `${seedInfoBox('amber', 'Domain Expiring Soon')}<p ${sP}>Your domain <strong>{{domain}}</strong> will expire on <strong>{{expiryDate}}</strong>.</p><p ${sP}>Please renew it before expiration to avoid losing access to this domain.</p>${seedBtn('{{renewUrl}}', 'Renew Domain')}`,
          variables: { domain: 'string', expiryDate: 'string', renewUrl: 'string' },
          enabled: true,
        },
        {
          slug: 'payment-failed',
          subject: 'Payment failed for your subscription',
          bodyHtml: `${seedInfoBox('red', 'Payment Failed')}<p ${sP}>We were unable to process the payment for your <strong>{{planName}}</strong> subscription.</p><p ${sP}>Please update your payment method to avoid service interruption.</p>${seedBtn('{{billingUrl}}', 'Update Payment')}`,
          variables: { planName: 'string', billingUrl: 'string' },
          enabled: true,
        },
        {
          slug: 'service-down',
          subject: 'Service alert: {{serviceName}} is down',
          bodyHtml: `${seedInfoBox('red', 'Service Down')}<p ${sP}>Your service <strong>{{serviceName}}</strong> has no running containers.</p>${seedMetaBox('Last Status', '{{lastStatus}}')}<p ${sMuted}>Check your dashboard for more details.</p>`,
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
      const defaults: { key: string; value: unknown }[] = [
        { key: 'platform:name', value: 'Fleet' },
        { key: 'platform:version', value: '0.1.0' },
        { key: 'platform:registrationEnabled', value: true },
        { key: 'platform:defaultPlan', value: 'none' },
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

/** Execute raw SQL in a dialect-appropriate way */
function execSql(db: any, sql: ReturnType<typeof drizzleSql>, dialect: string): any {
  if (dialect === 'sqlite') {
    return db.all(sql);
  }
  return db.execute(sql);
}

/** Execute raw write SQL in a dialect-appropriate way */
function runSql(db: any, sql: ReturnType<typeof drizzleSql>, dialect: string): any {
  if (dialect === 'sqlite') {
    return db.run(sql);
  }
  return db.execute(sql);
}

async function executeSeederLoop(db: any, schema: any, dialect: string): Promise<{ executed: number }> {
  let executed = 0;

  for (const seeder of seeders) {
    // Check if already run
    const existing = await execSql(
      db,
      drizzleSql`SELECT id FROM fleet_seeders WHERE version = ${seeder.version} AND description = ${seeder.description}`,
      dialect,
    );

    const rows = dialect === 'mysql' ? (existing as any)[0] : existing;
    if (rows && rows.length > 0) {
      continue;
    }

    await seeder.run(db, schema, dialect);

    await runSql(
      db,
      drizzleSql`INSERT INTO fleet_seeders (version, description) VALUES (${seeder.version}, ${seeder.description})`,
      dialect,
    );

    executed++;
  }

  return { executed };
}
