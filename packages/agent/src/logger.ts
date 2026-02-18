import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export const logger = pino({ name: 'fleet-agent', level: LOG_LEVEL });
