import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { prisma } from '../db/prisma';
import {
  AppError,
  ForbiddenError,
  UnauthorizedError,
} from '../lib/errors';
import { toPublicUser } from '../types/domain';

/**
 * Thrown when an endpoint requires `Settings.setupCompleted === true` but the
 * install has not finished its setup wizard yet. The frontend interprets a 409
 * with code `SETUP_INCOMPLETE` as "redirect the user to the setup wizard".
 */
export class SetupIncompleteError extends AppError {
  constructor(message = 'Setup is not complete') {
    super(message, 409, 'SETUP_INCOMPLETE');
  }
}

/**
 * Loads the user from the session and attaches `req.user`. Rejects sessions
 * pointing at deleted or deactivated users with the same generic
 * UnauthorizedError (no enumeration leak).
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedError('Authentication required');
    }
    req.user = toPublicUser(user);
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAdmin: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Compose: run requireAuth, then check role.
  await new Promise<void>((resolve, reject) => {
    requireAuth(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
  })
    .then(() => {
      if (!req.user || req.user.role !== 'ADMIN') {
        throw new ForbiddenError('Admin role required');
      }
      next();
    })
    .catch(next);
};

export const requireSetupComplete: RequestHandler = async (_req, _res, next) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings || !settings.setupCompleted) {
      throw new SetupIncompleteError(
        'First-run setup has not been completed yet'
      );
    }
    next();
  } catch (err) {
    next(err);
  }
};
