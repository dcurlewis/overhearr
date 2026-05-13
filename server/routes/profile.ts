import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { requireCsrfHeader } from '../middleware/csrf';
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from '../services/authService';

export const profileRouter = Router();

profileRouter.use(requireAuth);
profileRouter.use(requireCsrfHeader);

const passwordBodySchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(1, 'New password is required'),
});

/**
 * PATCH /api/profile/password — self-service password change.
 *
 * Requires the authenticated user's current password before updating.
 * Kept separate from the admin user CRUD to keep authz boundaries crisp.
 */
profileRouter.patch('/password', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');

    const parsed = passwordBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }
    const { currentPassword, newPassword } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!existing) throw new UnauthorizedError('Authentication required');

    const ok = await verifyPassword(currentPassword, existing.passwordHash);
    if (!ok) {
      throw new ValidationError('Current password is incorrect');
    }

    validatePasswordStrength(newPassword);
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash },
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default profileRouter;
