import { createMiddleware } from 'hono/factory';

export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '0');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Relaxed CSP for API docs (Scalar loads from CDN + uses inline scripts)
  const path = c.req.path;
  if (path === '/api/docs' || path.startsWith('/api/docs/')) {
    c.header('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; connect-src 'self'; frame-ancestors 'none'");
  } else {
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }

  if (process.env['NODE_ENV'] === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});
