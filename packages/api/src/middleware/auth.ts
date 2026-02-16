import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';

export interface AuthUser {
  userId: string;
  email: string;
  isSuper: boolean;
}

export const authMiddleware = createMiddleware<{
  Variables: {
    user: AuthUser;
  };
}>(async (c, next) => {
  const authorization = c.req.header('Authorization');

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }

  const token = authorization.slice(7);

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);

    c.set('user', {
      userId: payload['userId'] as string,
      email: payload['email'] as string,
      isSuper: payload['isSuper'] as boolean,
    });

    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
});
