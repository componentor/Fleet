import pino from 'pino';

// NOTE: pino must be added to dependencies in package.json:
//   pnpm add pino (and @types/pino as devDependency)
export const logger = pino({ name: 'fleet-agent' });
