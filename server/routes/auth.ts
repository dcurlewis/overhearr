import { Router } from 'express';
import { z } from 'zod';

import { getLogger } from '../lib/logger';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { requireCsrfHeader } from '../middleware/csrf';
import { loginRateLimiter } from '../middleware/rateLimit';
import { authenticate } from '../services/authService';

const log = getLogger('auth');

export const authRouter = Router();

const loginBodySchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * POST /api/auth/login
 *
 * Validates credentials, regenerates the session ID (prevents session
 * fixation), stores the userId, and returns the PublicUser.
 *
 * No CSRF header required: the user has no session yet, and the rate
 * limiter is the primary abuse control.
 */
authRouter.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }
    const { username, password } = parsed.data;

    const user = await authenticate(username, password);

    // Regenerate the session ID on login to prevent session fixation.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    log.info({ userId: user.id, username: user.username }, 'user logged in');
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout — destroy the session and clear the cookie.
 * 204 on success.
 */
authRouter.post('/logout', requireCsrfHeader, async (req, res, next) => {
  try {
    const userId = req.session?.userId;
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err) => (err ? reject(err) : resolve()));
    });
    res.clearCookie('overhearr.sid');
    if (userId) log.info({ userId }, 'user logged out');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me — returns the authenticated user, or 401.
 */
authRouter.get('/me', requireAuth, (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    res.json(req.user);
  } catch (err) {
    next(err);
  }
});

export default authRouter;
