import { Hono } from 'hono';
import { z } from 'zod';
import { db, services, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { dockerService } from '../services/docker.service.js';
import { logger } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';

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
    const columns = result.stdout.trim().split('\n').filter(s => s.trim()).map(line => {
      const parts = line.split('\t');
      return {
        name: parts[0]?.trim() ?? '',
        type: parts[1]?.trim() ?? '',
        nullable: (parts[2]?.trim() ?? 'YES') === 'YES',
        defaultValue: parts[3]?.trim() === '\\N' || parts[3]?.trim() === 'NULL' ? null : (parts[3]?.trim() ?? null),
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
    const countCmd = buildCommand(info, `SELECT COUNT(*) FROM "${tableName}"`);
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
    const orderClause = orderBy ? ` ORDER BY "${orderBy}" ${orderDir}` : '';
    const dataSql = `SELECT * FROM "${tableName}"${orderClause} LIMIT ${pageSize} OFFSET ${offset}`;
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

export default databaseRoutes;
