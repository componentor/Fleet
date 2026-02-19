import { Hono } from 'hono';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { createHmac, randomBytes } from 'node:crypto';
import { db, services, eq, and, isNull } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { dockerService } from '../services/docker.service.js';
import { logger } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';

// Short-lived download tokens (in-memory, 60s TTL)
const downloadTokens = new Map<string, { accountId: string; serviceId: string; db?: string; expiresAt: number }>();
const DOWNLOAD_TOKEN_TTL = 60_000; // 60 seconds

// Periodically clean up expired tokens
const tokenCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of downloadTokens) {
    if (now > val.expiresAt) downloadTokens.delete(key);
  }
}, 30_000);
tokenCleanup.unref();

const dbExecRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 60, keyPrefix: 'db-exec' });

// ---- Engine detection & command building ----

type DatabaseEngine = 'postgres' | 'mysql' | 'mariadb';

interface DatabaseInfo {
  engine: DatabaseEngine;
  user: string;
  password: string;
  database: string;
}

const ENGINE_PATTERNS: Array<{ pattern: RegExp; engine: DatabaseEngine }> = [
  { pattern: /^postgres/i, engine: 'postgres' },
  { pattern: /^bitnami\/postgresql/i, engine: 'postgres' },
  { pattern: /^mysql/i, engine: 'mysql' },
  { pattern: /^bitnami\/mysql/i, engine: 'mysql' },
  { pattern: /^mariadb/i, engine: 'mariadb' },
  { pattern: /^bitnami\/mariadb/i, engine: 'mariadb' },
];

function detectEngine(image: string): DatabaseEngine | null {
  for (const { pattern, engine } of ENGINE_PATTERNS) {
    if (pattern.test(image)) return engine;
  }
  return null;
}

function extractCredentials(engine: DatabaseEngine, env: Record<string, string>): DatabaseInfo {
  if (engine === 'postgres') {
    return {
      engine,
      user: env['POSTGRES_USER'] ?? 'postgres',
      password: env['POSTGRES_PASSWORD'] ?? '',
      database: env['POSTGRES_DB'] ?? env['POSTGRES_USER'] ?? 'postgres',
    };
  }
  // mysql / mariadb
  return {
    engine,
    user: env['MYSQL_USER'] ?? 'root',
    password: env['MYSQL_USER'] ? (env['MYSQL_PASSWORD'] ?? '') : (env['MYSQL_ROOT_PASSWORD'] ?? ''),
    database: env['MYSQL_DATABASE'] ?? '',
  };
}

function buildCommand(info: DatabaseInfo, sql: string): string[] {
  if (info.engine === 'postgres') {
    return ['psql', '-U', info.user, '-d', info.database, '-t', '-A', '-F', '\t', '-c', sql];
  }
  // mysql / mariadb
  const args = ['mysql', '-u', info.user, `-p${info.password}`, '-N', '-B', '-e', sql];
  if (info.database) args.splice(4, 0, info.database);
  return args;
}

// ---- Query validation ----

const DESTRUCTIVE_KEYWORDS = /^\s*(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE|GRANT|REVOKE|REPLACE|RENAME|COPY|VACUUM|LOAD|OPTIMIZE|FLUSH)\b/i;

function validateQuery(sql: string, readOnly: boolean): { valid: boolean; error?: string } {
  const trimmed = sql.trim();
  if (!trimmed) return { valid: false, error: 'Query cannot be empty' };
  if (trimmed.length > 10_000) return { valid: false, error: 'Query too long (max 10,000 characters)' };

  // Remove comments
  const cleaned = trimmed.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();

  // Check for multiple statements
  const statements = cleaned.split(';').filter(s => s.trim().length > 0);
  if (statements.length > 1) return { valid: false, error: 'Only single statements are allowed' };

  if (readOnly && DESTRUCTIVE_KEYWORDS.test(cleaned)) {
    return { valid: false, error: 'Destructive queries are not allowed in read-only mode' };
  }

  return { valid: true };
}

function enforceLimit(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (/\bLIMIT\s+\d+/i.test(trimmed)) return trimmed;
  if (/^\s*SELECT\b/i.test(trimmed)) return `${trimmed} LIMIT ${limit}`;
  return trimmed;
}

// ---- Identifier quoting & value escaping ----

function quoteIdentifier(engine: DatabaseEngine, name: string): string {
  if (engine === 'postgres') return `"${name}"`;
  return `\`${name}\``;
}

function escapeValue(engine: DatabaseEngine, value: string | null): string {
  if (value === null) return 'NULL';
  if (engine === 'postgres') {
    const tag = '$fleet$';
    if (value.includes(tag)) return `'${value.replace(/'/g, "''")}'`;
    return `${tag}${value}${tag}`;
  }
  // mysql / mariadb
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z');
  return `'${escaped}'`;
}

async function getPrimaryKeyColumns(
  engine: DatabaseEngine,
  info: DatabaseInfo,
  containerId: string,
  tableName: string,
): Promise<string[]> {
  let sql: string;
  if (engine === 'postgres') {
    sql = `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '${tableName}'::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`;
  } else {
    sql = `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`;
  }
  const cmd = buildCommand(info, sql);
  const result = await dockerService.execCommand(containerId, cmd);
  return result.stdout.trim().split('\n').filter(s => s.trim()).map(s => s.trim());
}

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const VALID_COLUMN_TYPE = /^[a-zA-Z][a-zA-Z0-9_ (),.]+$/;
const SAFE_DEFAULT = /^(\d+(\.\d+)?|'[^']*'|NULL|CURRENT_TIMESTAMP|NOW\(\)|TRUE|FALSE|uuid_generate_v4\(\)|gen_random_uuid\(\))$/i;

// ---- Helper to find running container ----

async function getDbContainer(accountId: string, serviceId: string) {
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc || !svc.dockerServiceId) return null;

  const engine = detectEngine(svc.image);
  if (!engine) return null;

  const tasks = await dockerService.getServiceTasks(svc.dockerServiceId);
  const running = tasks.find((t: any) => t.status === 'running' && t.containerStatus?.containerId);
  if (!running) return null;

  const containerId = (running as any).containerStatus.containerId;
  const info = extractCredentials(engine, (svc.env as Record<string, string>) ?? {});

  return { svc, engine, containerId, info };
}

// ---- Route definitions ----

const databaseRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

databaseRoutes.use('*', authMiddleware);
databaseRoutes.use('*', tenantMiddleware);

// GET /:serviceId/info
databaseRoutes.get('/:serviceId/info', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  const engine = detectEngine(svc.image);
  if (!engine) {
    return c.json({ isDatabase: false, engine: null, databases: [], database: '', status: 'unavailable' });
  }

  const container = await getDbContainer(accountId, serviceId);
  if (!container) {
    return c.json({ isDatabase: true, engine, databases: [], database: '', status: 'unavailable' });
  }

  // List databases
  let databases: string[] = [];
  try {
    let sql: string;
    if (engine === 'postgres') {
      sql = "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname";
    } else {
      sql = "SHOW DATABASES";
    }
    const cmd = buildCommand(container.info, sql);
    const result = await dockerService.execCommand(container.containerId, cmd);
    databases = result.stdout.trim().split('\n').filter(s => s.trim().length > 0);
  } catch (err) {
    logger.warn({ err }, 'Failed to list databases');
  }

  return c.json({
    isDatabase: true,
    engine,
    databases,
    database: container.info.database,
    status: 'available',
  });
});

// GET /:serviceId/tables
databaseRoutes.get('/:serviceId/tables', dbExecRateLimit, requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);

  const info = dbName ? { ...container.info, database: dbName } : container.info;

  let sql: string;
  if (container.engine === 'postgres') {
    sql = "SELECT tablename AS name, 'table' AS type FROM pg_tables WHERE schemaname = 'public' UNION ALL SELECT viewname AS name, 'view' AS type FROM pg_views WHERE schemaname = 'public' ORDER BY name";
  } else {
    sql = "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY name";
  }

  try {
    const cmd = buildCommand(info, sql);
    const result = await dockerService.execCommand(container.containerId, cmd);
    const tables = result.stdout.trim().split('\n').filter(s => s.trim()).map(line => {
      const parts = line.split('\t');
      return { name: parts[0]?.trim() ?? '', type: (parts[1]?.trim() ?? 'table').toLowerCase().includes('view') ? 'view' : 'table' };
    }).filter(t => t.name);

    return c.json({ tables });
  } catch (err) {
    logger.error({ err }, 'Failed to list tables');
    return c.json({ error: 'Failed to list tables' }, 500);
  }
});

// GET /:serviceId/tables/:name/columns
databaseRoutes.get('/:serviceId/tables/:name/columns', dbExecRateLimit, requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const tableName = c.req.param('name');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  // Validate table name (alphanumeric + underscore only)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return c.json({ error: 'Invalid table name' }, 400);
  }

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);

  const info = dbName ? { ...container.info, database: dbName } : container.info;

  let sql: string;
  if (container.engine === 'postgres') {
    sql = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tableName}' ORDER BY ordinal_position`;
  } else {
    sql = `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;
  }

  try {
    const cmd = buildCommand(info, sql);
    const result = await dockerService.execCommand(container.containerId, cmd);

    // Fetch primary key columns
    let pkSet = new Set<string>();
    try {
      const pkCols = await getPrimaryKeyColumns(container.engine, info, container.containerId, tableName);
      pkSet = new Set(pkCols);
    } catch { /* PK detection is best-effort */ }

    const columns = result.stdout.trim().split('\n').filter(s => s.trim()).map(line => {
      const parts = line.split('\t');
      const name = parts[0]?.trim() ?? '';
      return {
        name,
        type: parts[1]?.trim() ?? '',
        nullable: (parts[2]?.trim() ?? 'YES') === 'YES',
        defaultValue: parts[3]?.trim() === '\\N' || parts[3]?.trim() === 'NULL' ? null : (parts[3]?.trim() ?? null),
        isPrimaryKey: pkSet.has(name),
      };
    }).filter(col => col.name);

    return c.json({ columns });
  } catch (err) {
    logger.error({ err }, 'Failed to describe table');
    return c.json({ error: 'Failed to describe table' }, 500);
  }
});

// GET /:serviceId/tables/:name/data
databaseRoutes.get('/:serviceId/tables/:name/data', dbExecRateLimit, requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const tableName = c.req.param('name');
  const dbName = c.req.query('db');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') ?? '50', 10)));
  const orderBy = c.req.query('orderBy');
  const orderDir = c.req.query('orderDir') === 'desc' ? 'DESC' : 'ASC';
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return c.json({ error: 'Invalid table name' }, 400);
  }
  if (orderBy && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(orderBy)) {
    return c.json({ error: 'Invalid order column' }, 400);
  }

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);

  const info = dbName ? { ...container.info, database: dbName } : container.info;
  const offset = (page - 1) * pageSize;

  try {
    // Get total count
    const qi = (n: string) => quoteIdentifier(container.engine, n);
    const countCmd = buildCommand(info, `SELECT COUNT(*) FROM ${qi(tableName)}`);
    const countResult = await dockerService.execCommand(container.containerId, countCmd);
    const totalRows = parseInt(countResult.stdout.trim(), 10) || 0;

    // Get column names
    let colSql: string;
    if (container.engine === 'postgres') {
      colSql = `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tableName}' ORDER BY ordinal_position`;
    } else {
      colSql = `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;
    }
    const colResult = await dockerService.execCommand(container.containerId, buildCommand(info, colSql));
    const columns = colResult.stdout.trim().split('\n').filter(s => s.trim()).map(s => s.trim());

    // Get data
    const orderClause = orderBy ? ` ORDER BY ${qi(orderBy)} ${orderDir}` : '';
    const dataSql = `SELECT * FROM ${qi(tableName)}${orderClause} LIMIT ${pageSize} OFFSET ${offset}`;
    const dataCmd = buildCommand(info, dataSql);
    const dataResult = await dockerService.execCommand(container.containerId, dataCmd);
    const rows = dataResult.stdout.trim().split('\n').filter(s => s.length > 0).map(line => line.split('\t'));

    return c.json({ columns, rows, totalRows, page, pageSize });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch table data');
    return c.json({ error: 'Failed to fetch table data' }, 500);
  }
});

// POST /:serviceId/query
const querySchema = z.object({
  query: z.string().min(1).max(10_000),
  readOnly: z.boolean().default(true),
});

databaseRoutes.post('/:serviceId/query', dbExecRateLimit, requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const body = await c.req.json();
  const parsed = querySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid query' }, 400);

  const { query, readOnly } = parsed.data;

  const validation = validateQuery(query, readOnly);
  if (!validation.valid) return c.json({ error: validation.error }, 400);

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);

  const info = dbName ? { ...container.info, database: dbName } : container.info;

  // Enforce limit on SELECTs
  const limitedQuery = enforceLimit(query, 500);

  try {
    const start = Date.now();
    const cmd = buildCommand(info, limitedQuery);
    const result = await dockerService.execCommand(container.containerId, cmd);
    const executionTimeMs = Date.now() - start;

    const lines = result.stdout.trim().split('\n').filter(s => s.length > 0);
    const rows = lines.map(line => line.split('\t'));
    const truncated = result.stdout.length > 1_000_000;

    return c.json({
      columns: [],
      rows,
      rowCount: rows.length,
      executionTimeMs,
      truncated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Query execution failed';
    logger.error({ err }, 'Database query failed');
    return c.json({ error: message }, 500);
  }
});

// ---- CRUD: Row operations ----

const insertRowSchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.null()])),
});

const updateRowSchema = z.object({
  primaryKey: z.record(z.string(), z.string()),
  updates: z.record(z.string(), z.union([z.string(), z.null()])),
});

const deleteRowSchema = z.object({
  primaryKey: z.record(z.string(), z.string()),
});

const createTableSchema = z.object({
  name: z.string().regex(VALID_TABLE_NAME),
  columns: z.array(z.object({
    name: z.string().regex(VALID_TABLE_NAME),
    type: z.string().min(1).max(100),
    nullable: z.boolean().default(true),
    defaultValue: z.string().optional(),
    primaryKey: z.boolean().default(false),
  })).min(1).max(100),
});

// POST /:serviceId/tables/:name/rows — insert a row
databaseRoutes.post('/:serviceId/tables/:name/rows', dbExecRateLimit, requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const tableName = c.req.param('name');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);
  if (!VALID_TABLE_NAME.test(tableName)) return c.json({ error: 'Invalid table name' }, 400);

  const body = await c.req.json();
  const parsed = insertRowSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);

  const { values } = parsed.data;
  const columnNames = Object.keys(values);
  if (columnNames.length === 0) return c.json({ error: 'No values provided' }, 400);
  for (const col of columnNames) {
    if (!VALID_TABLE_NAME.test(col)) return c.json({ error: `Invalid column name: ${col}` }, 400);
  }

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);
  const info = dbName ? { ...container.info, database: dbName } : container.info;
  const qi = (n: string) => quoteIdentifier(container.engine, n);

  const quotedCols = columnNames.map(qi).join(', ');
  const escapedVals = columnNames.map(n => escapeValue(container.engine, values[n] ?? null)).join(', ');
  const sql = `INSERT INTO ${qi(tableName)} (${quotedCols}) VALUES (${escapedVals})`;

  try {
    const result = await dockerService.execCommand(container.containerId, buildCommand(info, sql));
    if (result.exitCode !== 0) return c.json({ error: result.stdout || 'Insert failed' }, 500);
    return c.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Database insert failed');
    return c.json({ error: err instanceof Error ? err.message : 'Insert failed' }, 500);
  }
});

// PUT /:serviceId/tables/:name/rows — update a row
databaseRoutes.put('/:serviceId/tables/:name/rows', dbExecRateLimit, requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const tableName = c.req.param('name');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);
  if (!VALID_TABLE_NAME.test(tableName)) return c.json({ error: 'Invalid table name' }, 400);

  const body = await c.req.json();
  const parsed = updateRowSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);

  const { primaryKey, updates } = parsed.data;
  if (Object.keys(updates).length === 0) return c.json({ error: 'No updates provided' }, 400);
  if (Object.keys(primaryKey).length === 0) return c.json({ error: 'No primary key provided' }, 400);
  for (const col of [...Object.keys(primaryKey), ...Object.keys(updates)]) {
    if (!VALID_TABLE_NAME.test(col)) return c.json({ error: `Invalid column name: ${col}` }, 400);
  }

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);
  const info = dbName ? { ...container.info, database: dbName } : container.info;
  const qi = (n: string) => quoteIdentifier(container.engine, n);

  const setClauses = Object.entries(updates)
    .map(([col, val]) => `${qi(col)} = ${escapeValue(container.engine, val)}`)
    .join(', ');
  const whereClauses = Object.entries(primaryKey)
    .map(([col, val]) => `${qi(col)} = ${escapeValue(container.engine, val)}`)
    .join(' AND ');
  const sql = `UPDATE ${qi(tableName)} SET ${setClauses} WHERE ${whereClauses}`;

  try {
    const result = await dockerService.execCommand(container.containerId, buildCommand(info, sql));
    if (result.exitCode !== 0) return c.json({ error: result.stdout || 'Update failed' }, 500);
    return c.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Database update failed');
    return c.json({ error: err instanceof Error ? err.message : 'Update failed' }, 500);
  }
});

// DELETE /:serviceId/tables/:name/rows — delete a row
databaseRoutes.delete('/:serviceId/tables/:name/rows', dbExecRateLimit, requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const tableName = c.req.param('name');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);
  if (!VALID_TABLE_NAME.test(tableName)) return c.json({ error: 'Invalid table name' }, 400);

  const body = await c.req.json();
  const parsed = deleteRowSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);

  const { primaryKey } = parsed.data;
  if (Object.keys(primaryKey).length === 0) return c.json({ error: 'No primary key provided' }, 400);
  for (const col of Object.keys(primaryKey)) {
    if (!VALID_TABLE_NAME.test(col)) return c.json({ error: `Invalid column name: ${col}` }, 400);
  }

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);
  const info = dbName ? { ...container.info, database: dbName } : container.info;
  const qi = (n: string) => quoteIdentifier(container.engine, n);

  const whereClauses = Object.entries(primaryKey)
    .map(([col, val]) => `${qi(col)} = ${escapeValue(container.engine, val)}`)
    .join(' AND ');
  const sql = `DELETE FROM ${qi(tableName)} WHERE ${whereClauses}`;

  try {
    const result = await dockerService.execCommand(container.containerId, buildCommand(info, sql));
    if (result.exitCode !== 0) return c.json({ error: result.stdout || 'Delete failed' }, 500);
    return c.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Database row delete failed');
    return c.json({ error: err instanceof Error ? err.message : 'Delete failed' }, 500);
  }
});

// ---- CRUD: Table operations ----

// POST /:serviceId/tables — create a table
databaseRoutes.post('/:serviceId/tables', dbExecRateLimit, requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const body = await c.req.json();
  const parsed = createTableSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);

  const { name, columns } = parsed.data;
  for (const col of columns) {
    if (!VALID_COLUMN_TYPE.test(col.type)) return c.json({ error: `Invalid column type: ${col.type}` }, 400);
    if (col.defaultValue && !SAFE_DEFAULT.test(col.defaultValue)) return c.json({ error: `Unsafe default value: ${col.defaultValue}` }, 400);
  }
  if (!columns.some(col => col.primaryKey)) return c.json({ error: 'At least one primary key column is required' }, 400);

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);
  const info = dbName ? { ...container.info, database: dbName } : container.info;
  const qi = (n: string) => quoteIdentifier(container.engine, n);

  const pkColumns = columns.filter(col => col.primaryKey).map(col => qi(col.name));
  const columnDefs = columns.map(col => {
    let def = `${qi(col.name)} ${col.type}`;
    if (!col.nullable) def += ' NOT NULL';
    if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
    return def;
  });
  columnDefs.push(`PRIMARY KEY (${pkColumns.join(', ')})`);
  const sql = `CREATE TABLE ${qi(name)} (${columnDefs.join(', ')})`;

  try {
    const result = await dockerService.execCommand(container.containerId, buildCommand(info, sql));
    if (result.exitCode !== 0) return c.json({ error: result.stdout || 'Create table failed' }, 500);
    return c.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Database create table failed');
    return c.json({ error: err instanceof Error ? err.message : 'Create table failed' }, 500);
  }
});

// DELETE /:serviceId/tables/:name — drop a table
databaseRoutes.delete('/:serviceId/tables/:name', dbExecRateLimit, requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const tableName = c.req.param('name');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);
  if (!VALID_TABLE_NAME.test(tableName)) return c.json({ error: 'Invalid table name' }, 400);

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);
  const info = dbName ? { ...container.info, database: dbName } : container.info;
  const sql = `DROP TABLE ${quoteIdentifier(container.engine, tableName)}`;

  try {
    const result = await dockerService.execCommand(container.containerId, buildCommand(info, sql));
    if (result.exitCode !== 0) return c.json({ error: result.stdout || 'Drop table failed' }, 500);
    return c.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Database drop table failed');
    return c.json({ error: err instanceof Error ? err.message : 'Drop table failed' }, 500);
  }
});

// GET /:serviceId/credentials — connection info & credentials
databaseRoutes.get('/:serviceId/credentials', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  const engine = detectEngine(svc.image);
  if (!engine) return c.json({ error: 'Not a database service' }, 400);

  const env = (svc.env as Record<string, string>) ?? {};
  const info = extractCredentials(engine, env);
  const ports = (svc.ports as Array<{ target: number; published: number }>) ?? [];

  const defaultPort = engine === 'postgres' ? 5432 : 3306;
  const publishedPort = ports.find(p => p.target === defaultPort)?.published ?? defaultPort;

  return c.json({
    engine,
    host: svc.name,
    port: publishedPort,
    user: info.user,
    password: info.password,
    database: info.database,
  });
});

// POST /:serviceId/export — create a short-lived download token so the browser
// can stream the dump directly (no blob buffering).
databaseRoutes.post('/:serviceId/export', dbExecRateLimit, requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  // Verify container is reachable before issuing a token
  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);

  const token = randomBytes(32).toString('hex');
  downloadTokens.set(token, {
    accountId,
    serviceId,
    db: dbName || undefined,
    expiresAt: Date.now() + DOWNLOAD_TOKEN_TTL,
  });

  return c.json({ token, expiresIn: DOWNLOAD_TOKEN_TTL / 1000 });
});

// The actual streaming GET is on databaseDownloadRoutes (no auth middleware)
// so the browser can fetch it directly via anchor click with a token query param.

// POST /:serviceId/import — restore a database from SQL dump
databaseRoutes.post('/:serviceId/import', dbExecRateLimit, requireMember, requireScope('write'), async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');
  const dbName = c.req.query('db');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const container = await getDbContainer(accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);

  const info = dbName ? { ...container.info, database: dbName } : container.info;

  // Parse uploaded file
  const body = await c.req.parseBody({ all: true });
  const file = body['file'] as File | undefined;
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'SQL file is required' }, 400);
  }

  const maxSize = 500 * 1024 * 1024; // 500MB
  if (file.size > maxSize) {
    return c.json({ error: 'File too large (max 500MB)' }, 400);
  }

  let cmd: string[];
  if (container.engine === 'postgres') {
    cmd = ['psql', '-U', info.user, '-d', info.database, '-v', 'ON_ERROR_STOP=1'];
  } else {
    cmd = ['mysql', '-u', info.user, `-p${info.password}`, info.database];
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const inputStream = Readable.from(buffer);

    const result = await dockerService.execCommandWithInput(container.containerId, cmd, inputStream);
    if (result.exitCode !== 0) {
      const errMsg = result.stderr?.slice(0, 500) || 'Import failed';
      return c.json({ error: errMsg }, 500);
    }
    return c.json({ success: true, message: 'Database import completed successfully' });
  } catch (err) {
    logger.error({ err }, 'Database import failed');
    return c.json({ error: err instanceof Error ? err.message : 'Import failed' }, 500);
  }
});

// ---- Public (unauthenticated) download route — token-gated ----
// Mounted separately in app.ts without auth/tenant middleware so the browser
// can stream the file directly via an anchor click.

export const databaseDownloadRoutes = new Hono();

databaseDownloadRoutes.get('/:serviceId/export', dbExecRateLimit, async (c) => {
  const serviceId = c.req.param('serviceId');
  const tokenParam = c.req.query('token');

  if (!tokenParam) {
    return c.json({ error: 'Download token required' }, 401);
  }

  const entry = downloadTokens.get(tokenParam);
  if (!entry || Date.now() > entry.expiresAt || entry.serviceId !== serviceId) {
    return c.json({ error: 'Invalid or expired download token' }, 403);
  }
  downloadTokens.delete(tokenParam); // one-time use

  const container = await getDbContainer(entry.accountId, serviceId);
  if (!container) return c.json({ error: 'Database container not available' }, 503);

  const info = entry.db ? { ...container.info, database: entry.db } : container.info;

  let cmd: string[];
  let filename: string;
  if (container.engine === 'postgres') {
    cmd = ['pg_dump', '-U', info.user, '-d', info.database, '--no-owner', '--no-acl'];
    filename = `${info.database}-${new Date().toISOString().slice(0, 10)}.sql`;
  } else {
    cmd = ['mysqldump', '-u', info.user, `-p${info.password}`, '--single-transaction', '--routines', '--triggers', info.database];
    filename = `${info.database}-${new Date().toISOString().slice(0, 10)}.sql`;
  }

  try {
    const { stream } = await dockerService.execCommandStream(container.containerId, cmd);
    c.header('Content-Type', 'application/sql');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    return c.body(stream as any);
  } catch (err) {
    logger.error({ err }, 'Database export failed');
    return c.json({ error: 'Export failed' }, 500);
  }
});

export default databaseRoutes;
