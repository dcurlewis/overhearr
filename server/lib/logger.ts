import pino, { type Logger, type LoggerOptions } from 'pino';

import { env, isProduction } from '../config/env';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.apiKey',
  '*.lidarrApiKey',
];

const baseOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'overhearr' },
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

const transport = !isProduction
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,service',
        singleLine: false,
      },
    }
  : undefined;

export const logger: Logger = pino({
  ...baseOptions,
  ...(transport ? { transport } : {}),
});

export function getLogger(name: string): Logger {
  return logger.child({ name });
}

export default logger;
