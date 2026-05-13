import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';

import { isProduction } from '../config/env';
import { AppError, NotFoundError } from '../lib/errors';
import { getLogger } from '../lib/logger';

const log = getLogger('http');

type RequestWithLogger = Request & { log?: Logger };

/**
 * 404 handler for unmatched /api/* routes. Non-/api requests fall through to
 * the Next.js handler, so this should only be mounted on the API namespace.
 */
export const apiNotFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, _next) => {
  const reqWithLog = req as RequestWithLogger;
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError
    ? err.message
    : isProduction
      ? 'Internal server error'
      : (err as Error)?.message || 'Internal server error';

  const logPayload = {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    code,
    message: (err as Error)?.message,
    ...(isProduction ? {} : { stack: (err as Error)?.stack }),
  };

  // Use the request-bound logger if pino-http attached one; otherwise fall back.
  const target = reqWithLog.log ?? log;
  if (statusCode >= 500) {
    target.error(logPayload, 'request failed');
  } else {
    target.error(logPayload, 'request error');
  }

  if (res.headersSent) {
    return;
  }

  const body: Record<string, unknown> = {
    error: { code, message },
  };
  if (!isProduction && !isAppError && (err as Error)?.stack) {
    (body.error as Record<string, unknown>).stack = (err as Error).stack;
  }

  res.status(statusCode).json(body);
};
