import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, platformSettings, rawClient, eq, getDialect } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { loadAdminPermissions, requireAdminPermission } from '../middleware/admin-permission.js';
import type { AdminPermissions } from '../middleware/admin-permission.js';
import {
  jsonBody,
  jsonContent,
  errorResponseSchema,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

type Env = {
  Variables: { user: AuthUser; adminPermissions: AdminPermissions | null };
};

const platformDbRoutes = new OpenAPIHono<Env>();
const dialect = getDialect();

if (!rawClient) {
  console.error('[platform-db] rawClient is null — database admin will not work');
}

// ── Dialect abstraction layer ──

/** Quote an identifier for the active dialect */
function qi(name: string): string {
  if (dialect === 'mysql') return `\`${name}\``;
  return `"${name}"`;  // pg + sqlite
}

/** Placeholder for positional params ($1 for pg, ? for mysql/sqlite) */
function ph(index: number): string {
  if (dialect === 'pg') return `$${index}`;
  return '?';
}

/**
 * Execute a raw SQL query and return rows as plain objects.
 * Handles the different client APIs across dialects:
 * - PG: postgres-js `rawClient.unsafe(sql, params)`
 * - MySQL: mysql2 `pool.query(sql, params)` → [rows, fields]
 * - SQLite: better-sqlite3 `db.prepare(sql).all(params)` (sync)
 */
async function dbExec(query: string, params: any[] = []): Promise<{ rows: any[]; count: number }> {
  const client = rawClient as any;
  if (!client) throw new Error(`rawClient is null (dialect=${dialect})`);

  if (dialect === 'pg') {
    const result = await client.unsafe(query, params);
    return { rows: Array.from(result), count: result.count ?? result.length };
  }

  if (dialect === 'mysql') {
    const [rows] = await client.query(query, params);
    return { rows: rows as any[], count: (rows as any[]).length };
  }

  // SQLite — synchronous better-sqlite3
  const trimmed = query.trim().toUpperCase();
  const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH');
  if (isSelect) {
    const rows = client.prepare(query).all(...params);
    return { rows, count: rows.length };
  }
  const info = client.prepare(query).run(...params);
  return { rows: [], count: info.changes ?? 0 };
}

// ── Auth + permission middleware ──

platformDbRoutes.use('*', authMiddleware);
platformDbRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper && !user.adminRoleId) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
});
platformDbRoutes.use('*', loadAdminPermissions);
platformDbRoutes.use('*', requireAdminPermission('database', 'read'));

// Write permission for mutating operations (POST/PUT/DELETE)
const requireDbWrite = requireAdminPermission('database', 'write');
platformDbRoutes.use('*', async (c, next) => {
  const method = c.req.method;
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    return requireDbWrite(c, next);
  }
  await next();
});

// Valid SQL identifier pattern
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateIdentifier(name: string): boolean {
  return IDENT_RE.test(name) && name.length <= 128;
}

// ── Schemas ──

const tableNameParamSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).openapi({ description: 'Table name' }),
});

const paginationQuerySchema = z.object({
  page: z.string().optional().openapi({ description: 'Page number (default 1)' }),
  pageSize: z.string().optional().openapi({ description: 'Rows per page (default 50, max 10000)' }),
  sortBy: z.string().optional().openapi({ description: 'Column to sort by' }),
  sortDir: z.enum(['asc', 'desc']).optional().openapi({ description: 'Sort direction' }),
});

// ── GET /tables ──

const listTablesRoute = createRoute({
  method: 'get',
  path: '/tables',
  tags: ['Platform DB'],
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({ tables: z.array(z.object({ name: z.string(), rowCount: z.number().optional() })), dialect: z.string() }), 'Table list'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(listTablesRoute, (async (c: any) => {
  try {
    let tables: { name: string; rowCount?: number }[] = [];

    if (dialect === 'pg') {
      const { rows } = await dbExec(`
        SELECT t.table_name as name, s.n_live_tup::int as row_count
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `);
      tables = rows.map((r: any) => ({ name: r.name, rowCount: r.row_count ?? 0 }));
    } else if (dialect === 'mysql') {
      const { rows } = await dbExec(`
        SELECT table_name as name, table_rows as row_count
        FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);
      tables = rows.map((r: any) => ({ name: r.name ?? r.TABLE_NAME, rowCount: r.row_count ?? r.TABLE_ROWS ?? 0 }));
    } else {
      const { rows } = await dbExec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
      tables = rows.map((r: any) => ({ name: r.name }));
    }

    return c.json({ tables, dialect });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to list tables', tables: [], dialect } as any, 500);
  }
}) as any);

// ── GET /tables/:name/columns ──

const listColumnsRoute = createRoute({
  method: 'get',
  path: '/tables/{name}/columns',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: { params: tableNameParamSchema },
  responses: {
    200: jsonContent(z.object({
      columns: z.array(z.object({
        name: z.string(),
        type: z.string(),
        nullable: z.boolean(),
        defaultValue: z.string().nullable(),
        isPrimaryKey: z.boolean(),
      })),
    }), 'Column schema'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(listColumnsRoute, (async (c: any) => {
  const { name } = c.req.valid('param');
  if (!validateIdentifier(name)) return c.json({ error: 'Invalid table name' }, 400);

  let columns: { name: string; type: string; nullable: boolean; defaultValue: string | null; isPrimaryKey: boolean }[] = [];

  if (dialect === 'pg') {
    const { rows } = await dbExec(`
      SELECT
        c.column_name as name,
        c.data_type as type,
        (c.is_nullable = 'YES') as nullable,
        c.column_default as default_value,
        COALESCE(pk.is_pk, false) as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, true as is_pk
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = 'public'
      ) pk ON pk.column_name = c.column_name
      WHERE c.table_name = $1 AND c.table_schema = 'public'
      ORDER BY c.ordinal_position
    `, [name]);
    columns = rows.map((r: any) => ({
      name: r.name, type: r.type, nullable: !!r.nullable,
      defaultValue: r.default_value, isPrimaryKey: !!r.is_primary_key,
    }));
  } else if (dialect === 'mysql') {
    const { rows } = await dbExec(`
      SELECT column_name as name, column_type as type, is_nullable, column_default as default_value, column_key
      FROM information_schema.columns
      WHERE table_name = ? AND table_schema = DATABASE()
      ORDER BY ordinal_position
    `, [name]);
    columns = rows.map((r: any) => ({
      name: r.name ?? r.COLUMN_NAME,
      type: r.type ?? r.COLUMN_TYPE,
      nullable: (r.is_nullable ?? r.IS_NULLABLE) === 'YES',
      defaultValue: r.default_value ?? r.COLUMN_DEFAULT,
      isPrimaryKey: (r.column_key ?? r.COLUMN_KEY) === 'PRI',
    }));
  } else {
    const { rows } = await dbExec(`PRAGMA table_info("${name}")`);
    columns = rows.map((r: any) => ({
      name: r.name, type: r.type || 'TEXT', nullable: r.notnull === 0,
      defaultValue: r.dflt_value, isPrimaryKey: r.pk === 1,
    }));
  }

  return c.json({ columns });
}) as any);

// ── GET /tables/:name/data ──

const getTableDataRoute = createRoute({
  method: 'get',
  path: '/tables/{name}/data',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: { params: tableNameParamSchema, query: paginationQuerySchema },
  responses: {
    200: jsonContent(z.object({
      rows: z.array(z.record(z.string(), z.unknown())),
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
    }), 'Table data'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(getTableDataRoute, (async (c: any) => {
  const { name } = c.req.valid('param');
  if (!validateIdentifier(name)) return c.json({ error: 'Invalid table name' }, 400);

  const query = c.req.valid('query');
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(10000, Math.max(1, Number(query.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  const sortBy = query.sortBy && validateIdentifier(query.sortBy) ? query.sortBy : null;
  const sortDir = query.sortDir === 'desc' ? 'DESC' : 'ASC';

  const qn = qi(name);
  const countResult = await dbExec(`SELECT count(*) as total FROM ${qn}`);
  const total = Number(countResult.rows[0]?.total ?? 0);

  const orderClause = sortBy ? ` ORDER BY ${qi(sortBy)} ${sortDir}` : '';
  const { rows } = await dbExec(`SELECT * FROM ${qn}${orderClause} LIMIT ${pageSize} OFFSET ${offset}`);

  return c.json({ rows, total, page, pageSize });
}) as any);

// ── POST /query ──

const executeQueryRoute = createRoute({
  method: 'post',
  path: '/query',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: { body: jsonBody(z.object({ query: z.string().min(1).max(100_000) })) },
  responses: {
    200: jsonContent(z.object({
      rows: z.array(z.record(z.string(), z.unknown())),
      columns: z.array(z.string()),
      rowCount: z.number(),
      durationMs: z.number(),
    }), 'Query result'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(executeQueryRoute, (async (c: any) => {
  const { query } = c.req.valid('json');
  const start = performance.now();

  try {
    const { rows, count } = await dbExec(query);
    const durationMs = Math.round(performance.now() - start);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return c.json({ rows, columns, rowCount: count, durationMs });
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - start);
    return c.json({ error: err.message || 'Query execution failed', durationMs } as any, 400);
  }
}) as any);

// ── POST /tables/:name/rows ──

const insertRowRoute = createRoute({
  method: 'post',
  path: '/tables/{name}/rows',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: { params: tableNameParamSchema, body: jsonBody(z.object({ row: z.record(z.string(), z.unknown()) })) },
  responses: {
    200: jsonContent(z.object({ row: z.record(z.string(), z.unknown()).nullable() }), 'Inserted row'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(insertRowRoute, (async (c: any) => {
  const { name } = c.req.valid('param');
  if (!validateIdentifier(name)) return c.json({ error: 'Invalid table name' }, 400);
  const { row } = c.req.valid('json');

  const cols = Object.keys(row).filter(validateIdentifier);
  if (cols.length === 0) return c.json({ error: 'No valid columns' }, 400);

  const colNames = cols.map(qi).join(', ');
  const placeholders = cols.map((_, i) => ph(i + 1)).join(', ');
  const values = cols.map((c) => row[c]);

  try {
    if (dialect === 'pg') {
      const { rows } = await dbExec(
        `INSERT INTO ${qi(name)} (${colNames}) VALUES (${placeholders}) RETURNING *`, values,
      );
      return c.json({ row: rows[0] ?? null });
    } else if (dialect === 'mysql') {
      await dbExec(`INSERT INTO ${qi(name)} (${colNames}) VALUES (${placeholders})`, values);
      const { rows } = await dbExec(`SELECT * FROM ${qi(name)} ORDER BY 1 DESC LIMIT 1`);
      return c.json({ row: rows[0] ?? null });
    } else {
      await dbExec(`INSERT INTO ${qi(name)} (${colNames}) VALUES (${placeholders})`, values);
      const { rows } = await dbExec(`SELECT * FROM ${qi(name)} WHERE rowid = last_insert_rowid()`);
      return c.json({ row: rows[0] ?? null });
    }
  } catch (err: any) {
    return c.json({ error: err.message || 'Insert failed' }, 400);
  }
}) as any);

// ── PUT /tables/:name/rows ──

const updateRowRoute = createRoute({
  method: 'put',
  path: '/tables/{name}/rows',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: {
    params: tableNameParamSchema,
    body: jsonBody(z.object({
      primaryKeys: z.record(z.string(), z.unknown()),
      updates: z.record(z.string(), z.unknown()),
    })),
  },
  responses: {
    200: jsonContent(z.object({ row: z.record(z.string(), z.unknown()).nullable() }), 'Updated row'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(updateRowRoute, (async (c: any) => {
  const { name } = c.req.valid('param');
  if (!validateIdentifier(name)) return c.json({ error: 'Invalid table name' }, 400);
  const { primaryKeys, updates } = c.req.valid('json');

  const updateCols = Object.keys(updates).filter(validateIdentifier);
  const pkCols = Object.keys(primaryKeys).filter(validateIdentifier);
  if (updateCols.length === 0) return c.json({ error: 'No valid update columns' }, 400);
  if (pkCols.length === 0) return c.json({ error: 'No valid primary key columns' }, 400);

  const values: any[] = [];
  let paramIdx = 1;
  const setClauses = updateCols.map((col) => {
    values.push(updates[col]);
    return `${qi(col)} = ${ph(paramIdx++)}`;
  });
  const whereClauses = pkCols.map((col) => {
    values.push(primaryKeys[col]);
    return `${qi(col)} = ${ph(paramIdx++)}`;
  });

  try {
    if (dialect === 'pg') {
      const { rows } = await dbExec(
        `UPDATE ${qi(name)} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')} RETURNING *`, values,
      );
      if (rows.length === 0) return c.json({ error: 'Row not found' }, 404);
      return c.json({ row: rows[0] });
    } else {
      const { count } = await dbExec(
        `UPDATE ${qi(name)} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`, values,
      );
      if (count === 0) return c.json({ error: 'Row not found' }, 404);
      // Re-fetch updated row
      const pkValues = pkCols.map((col) => primaryKeys[col]);
      const pkWhere = pkCols.map((col, i) => `${qi(col)} = ${ph(i + 1)}`).join(' AND ');
      const { rows } = await dbExec(`SELECT * FROM ${qi(name)} WHERE ${pkWhere}`, pkValues);
      return c.json({ row: rows[0] ?? null });
    }
  } catch (err: any) {
    return c.json({ error: err.message || 'Update failed' }, 400);
  }
}) as any);

// ── DELETE /tables/:name/rows ──

const deleteRowRoute = createRoute({
  method: 'delete',
  path: '/tables/{name}/rows',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: {
    params: tableNameParamSchema,
    body: jsonBody(z.object({ primaryKeys: z.record(z.string(), z.unknown()) })),
  },
  responses: {
    200: jsonContent(z.object({ deleted: z.boolean() }), 'Deletion result'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(deleteRowRoute, (async (c: any) => {
  const { name } = c.req.valid('param');
  if (!validateIdentifier(name)) return c.json({ error: 'Invalid table name' }, 400);
  const { primaryKeys } = c.req.valid('json');

  const pkCols = Object.keys(primaryKeys).filter(validateIdentifier);
  if (pkCols.length === 0) return c.json({ error: 'No valid primary key columns' }, 400);

  const values: any[] = [];
  const whereClauses = pkCols.map((col, i) => {
    values.push(primaryKeys[col]);
    return `${qi(col)} = ${ph(i + 1)}`;
  });

  try {
    const { count } = await dbExec(
      `DELETE FROM ${qi(name)} WHERE ${whereClauses.join(' AND ')}`, values,
    );
    return c.json({ deleted: count > 0 });
  } catch (err: any) {
    return c.json({ error: err.message || 'Delete failed' }, 400);
  }
}) as any);

// ── POST /tables (create table) ──

const createTableRoute = createRoute({
  method: 'post',
  path: '/tables',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: {
    body: jsonBody(z.object({
      name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
      columns: z.array(z.object({
        name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
        type: z.string().min(1).max(100),
        nullable: z.boolean().optional(),
        defaultValue: z.string().optional(),
        primaryKey: z.boolean().optional(),
      })).min(1),
    })),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string() }), 'Table created'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(createTableRoute, (async (c: any) => {
  const { name, columns } = c.req.valid('json');
  if (!validateIdentifier(name)) return c.json({ error: 'Invalid table name' }, 400);

  const colDefs = columns.map((col: any) => {
    if (!validateIdentifier(col.name)) throw new Error(`Invalid column name: ${col.name}`);
    let def = `${qi(col.name)} ${col.type}`;
    if (col.primaryKey) def += ' PRIMARY KEY';
    if (!col.nullable && !col.primaryKey) def += ' NOT NULL';
    if (col.defaultValue !== undefined) def += ` DEFAULT ${col.defaultValue}`;
    return def;
  });

  try {
    await dbExec(`CREATE TABLE ${qi(name)} (${colDefs.join(', ')})`);
    return c.json({ message: `Table "${name}" created` });
  } catch (err: any) {
    return c.json({ error: err.message || 'Create table failed' }, 400);
  }
}) as any);

// ── DELETE /tables/:name (drop table) ──

const dropTableRoute = createRoute({
  method: 'delete',
  path: '/tables/{name}',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: {
    params: tableNameParamSchema,
    query: z.object({ confirm: z.literal('true').openapi({ description: 'Must be "true" to confirm' }) }),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string() }), 'Table dropped'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(dropTableRoute, (async (c: any) => {
  const { name } = c.req.valid('param');
  if (!validateIdentifier(name)) return c.json({ error: 'Invalid table name' }, 400);

  try {
    await dbExec(`DROP TABLE ${qi(name)}`);
    return c.json({ message: `Table "${name}" dropped` });
  } catch (err: any) {
    return c.json({ error: err.message || 'Drop table failed' }, 400);
  }
}) as any);

// ── GET /connection-info ──

const connectionInfoRoute = createRoute({
  method: 'get',
  path: '/connection-info',
  tags: ['Platform DB'],
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      dialect: z.string(),
      host: z.string(),
      port: z.number(),
      database: z.string(),
      username: z.string(),
      connectionString: z.string(),
      cliCommand: z.string(),
      sshTunnel: z.string(),
    }), 'Connection info'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(connectionInfoRoute, (async (c: any) => {
  const dbUrl = process.env['DATABASE_URL'] || '';

  if (dialect === 'sqlite') {
    return c.json({
      dialect: 'sqlite',
      host: 'localhost',
      port: 0,
      database: dbUrl || 'fleet.db',
      username: '',
      connectionString: dbUrl || 'fleet.db',
      cliCommand: `sqlite3 ${dbUrl || 'fleet.db'}`,
      sshTunnel: 'ssh user@your-server-ip',
    });
  }

  let host = 'localhost', port = dialect === 'pg' ? 5432 : 3306;
  let database = 'fleet', username = 'fleet';

  try {
    const url = new URL(dbUrl);
    host = url.hostname;
    port = Number(url.port) || port;
    database = url.pathname.replace('/', '') || 'fleet';
    username = url.username || 'fleet';
  } catch {
    // Fallback to defaults
  }

  if (dialect === 'mysql') {
    return c.json({
      dialect: 'mysql',
      host, port, database, username,
      connectionString: `mysql://${username}:****@${host}:${port}/${database}`,
      cliCommand: `mysql -h ${host} -P ${port} -u ${username} -p ${database}`,
      sshTunnel: `ssh -L ${port}:${host}:${port} user@your-server-ip`,
    });
  }

  return c.json({
    dialect: 'pg',
    host, port, database, username,
    connectionString: `postgresql://${username}:****@${host}:${port}/${database}`,
    cliCommand: `psql -h ${host} -p ${port} -U ${username} -d ${database}`,
    sshTunnel: `ssh -L ${port}:${host}:${port} user@your-server-ip`,
  });
}) as any);

// ── GET /stats ──

const statsRoute = createRoute({
  method: 'get',
  path: '/stats',
  tags: ['Platform DB'],
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      dialect: z.string(),
      version: z.string(),
      databaseSize: z.string(),
      tableCount: z.number(),
      activeConnections: z.number(),
    }), 'Database stats'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(statsRoute, (async (c: any) => {
  try {
    if (dialect === 'pg') {
      const v = await dbExec('SELECT version()');
      const s = await dbExec('SELECT pg_size_pretty(pg_database_size(current_database())) as size');
      const t = await dbExec(`SELECT count(*)::int as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
      const cn = await dbExec('SELECT count(*)::int as count FROM pg_stat_activity WHERE datname = current_database()');
      return c.json({
        dialect: 'pg',
        version: v.rows[0]?.version ?? 'unknown',
        databaseSize: s.rows[0]?.size ?? 'unknown',
        tableCount: Number(t.rows[0]?.count ?? 0),
        activeConnections: Number(cn.rows[0]?.count ?? 0),
      });
    }

    if (dialect === 'mysql') {
      const v = await dbExec('SELECT version() as version');
      const s = await dbExec(`SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb FROM information_schema.tables WHERE table_schema = DATABASE()`);
      const t = await dbExec(`SELECT count(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`);
      const cn = await dbExec('SELECT count(*) as count FROM information_schema.processlist');
      return c.json({
        dialect: 'mysql',
        version: `MySQL ${v.rows[0]?.version ?? 'unknown'}`,
        databaseSize: `${s.rows[0]?.size_mb ?? 0} MB`,
        tableCount: Number(t.rows[0]?.count ?? 0),
        activeConnections: Number(cn.rows[0]?.count ?? 0),
      });
    }

    // SQLite
    const v = await dbExec('SELECT sqlite_version() as version');
    const t = await dbExec(`SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
    const p = await dbExec('PRAGMA page_count');
    const ps = await dbExec('PRAGMA page_size');
    const sizeBytes = (p.rows[0]?.page_count ?? 0) * (ps.rows[0]?.page_size ?? 4096);
    const sizeMb = (sizeBytes / 1024 / 1024).toFixed(2);
    return c.json({
      dialect: 'sqlite',
      version: `SQLite ${v.rows[0]?.version ?? 'unknown'}`,
      databaseSize: `${sizeMb} MB`,
      tableCount: Number(t.rows[0]?.count ?? 0),
      activeConnections: 1,
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch stats' }, 500);
  }
}) as any);

// ── GET /ip-allowlist ──

const getIpAllowlistRoute = createRoute({
  method: 'get',
  path: '/ip-allowlist',
  tags: ['Platform DB'],
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      allowlist: z.array(z.string()),
      currentIp: z.string(),
    }), 'IP allowlist'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(getIpAllowlistRoute, (async (c: any) => {
  const rows = await db.select().from(platformSettings).where(eq(platformSettings.key, 'database:admin:ip_allowlist'));
  const allowlist = rows.length > 0 && rows[0]?.value ? JSON.parse(rows[0]!.value as string) : [];
  const currentIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  return c.json({ allowlist, currentIp });
}) as any);

// ── PUT /ip-allowlist ──

const updateIpAllowlistRoute = createRoute({
  method: 'put',
  path: '/ip-allowlist',
  tags: ['Platform DB'],
  security: bearerSecurity,
  request: { body: jsonBody(z.object({ allowlist: z.array(z.string().max(45)).max(100) })) },
  responses: {
    200: jsonContent(z.object({ allowlist: z.array(z.string()) }), 'Updated allowlist'),
    ...standardErrors,
  },
});

platformDbRoutes.openapi(updateIpAllowlistRoute, async (c) => {
  const { allowlist } = c.req.valid('json');
  const value = JSON.stringify(allowlist);

  await db.insert(platformSettings).values({ key: 'database:admin:ip_allowlist', value })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value } });

  return c.json({ allowlist });
});

export default platformDbRoutes;
