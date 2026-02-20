import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'password',
      'passwordHash',
      'accessToken',
      'refreshToken',
      'token',
      'apiKey',
      'apiSecret',
      'secret',
      'authorization',
      'cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  transport: process.env['NODE_ENV'] !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

/**
 * Write an application-level warning/error to the error_log DB table.
 * Fire-and-forget — never blocks the caller.
 */
export function logToErrorTable(entry: {
  level: 'warn' | 'error' | 'fatal';
  message: string;
  stack?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}): void {
  // Lazy import to avoid circular dependency at module load time
  import('@fleet/db').then(({ db, errorLog }) => {
    db.insert(errorLog)
      .values({
        level: entry.level,
        message: entry.message,
        stack: entry.stack ?? null,
        method: entry.method ?? null,
        path: entry.path ?? null,
        statusCode: entry.statusCode ?? null,
        userId: entry.userId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: entry.metadata ?? null,
      })
      .catch((err) => logger.error({ err }, 'Failed to write to error_log table'));
  }).catch((err) => logger.error({ err }, 'Failed to import @fleet/db for error logging'));
}
