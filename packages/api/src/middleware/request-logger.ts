import { createMiddleware } from 'hono/factory';
import { logger } from '../services/logger.js';

export const requestLogger = createMiddleware(async (c, next) => {
  const start = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  c.set('requestId', requestId);

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const method = c.req.method;
  const path = c.req.path;

  const logFn = status >= 500 ? logger.error : status >= 400 ? logger.warn : logger.info;
  logFn.call(logger, { requestId, method, path, status, durationMs: duration }, `${method} ${path} ${status}`);
});
