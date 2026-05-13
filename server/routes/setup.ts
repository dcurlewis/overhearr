import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma';
import { ConflictError, ValidationError } from '../lib/errors';
import { getLogger } from '../lib/logger';
import { requireAdmin } from '../middleware/auth';
import { requireCsrfHeader } from '../middleware/csrf';
import { loginRateLimiter } from '../middleware/rateLimit';
import {
  hashPassword,
  normalizeUsername,
  validatePasswordStrength,
} from '../services/authService';
import { settingsService } from '../services/settingsService';
import { toPublicUser } from '../types/domain';

const log = getLogger('setup');

export const setupRouter = Router();

/**
 * Public — used by the frontend on every page load to decide whether to
 * redirect a fresh install to the setup wizard.
 */
setupRouter.get('/status', async (_req, res) => {
  // Singleton settings row; create with defaults on first hit.
  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });

  res.json({
    setupCompleted: settings.setupCompleted,
    hasAdmin: adminCount > 0,
  });
});

const initializeBodySchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32, 'Username must be at most 32 characters')
    .regex(
      /^[A-Za-z0-9_-]+$/,
      'Username may only contain letters, digits, underscores and hyphens'
    ),
  password: z.string().min(1, 'Password is required'),
});

/**
 * One-shot first-run admin creation. Refuses to run if any admin already
 * exists — making this a safe public endpoint indefinitely.
 *
 * Note: setupCompleted stays `false` until Phase 2b's full settings flow
 * (Lidarr config) finishes. UI tracks "step 1 of N" itself.
 */
setupRouter.post('/initialize', loginRateLimiter, async (req, res, next) => {
  try {
    const parsed = initializeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid request body';
      throw new ValidationError(msg);
    }
    const { password } = parsed.data;
    const username = normalizeUsername(parsed.data.username);

    validatePasswordStrength(password);

    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });
    if (existingAdmin) {
      throw new ConflictError('Setup already initialized');
    }
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (settings?.setupCompleted) {
      throw new ConflictError('Setup already completed');
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      // Ensure singleton settings row exists, but do NOT flip setupCompleted
      // here — that happens in Phase 2b after Lidarr config is saved.
      await tx.settings.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
      });
      return tx.user.create({
        data: {
          username,
          passwordHash,
          role: 'ADMIN',
          isActive: true,
        },
      });
    });

    // Log the new admin in.
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    log.info({ userId: user.id, username: user.username }, 'first admin created');

    res.status(201).json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

/**
 * Final step of the first-run wizard. Admin-only + CSRF-protected. Refuses
 * if Lidarr settings are not yet fully populated — the SettingsService
 * raises a ValidationError in that case.
 */
setupRouter.post(
  '/complete',
  requireAdmin,
  requireCsrfHeader,
  async (_req, res, next) => {
    try {
      await settingsService.markSetupCompleted();
      log.info('setup completed');
      res.json({ setupCompleted: true });
    } catch (err) {
      next(err);
    }
  }
);

export default setupRouter;
