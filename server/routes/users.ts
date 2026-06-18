import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../db/prisma';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../lib/errors';
import { requireAdmin } from '../middleware/auth';
import { requireCsrfHeader } from '../middleware/csrf';
import {
  hashPassword,
  normalizeUsername,
  validatePasswordStrength,
} from '../services/authService';
import { toPublicUser, UserRoleEnum } from '../types/domain';

export const usersRouter = Router();

// Admin-only + CSRF for all routes in this router.
usersRouter.use(requireAdmin);
usersRouter.use(requireCsrfHeader);

const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'Username may only contain letters, digits, underscores and hyphens'
  );

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBodySchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, 'Password is required'),
  role: UserRoleEnum.optional(),
});

const patchBodySchema = z
  .object({
    username: usernameSchema.optional(),
    password: z.string().min(1).optional(),
    role: UserRoleEnum.optional(),
    isActive: z.boolean().optional(),
    // Per-user request-quota overrides. A positive integer sets an override;
    // null clears it (the user then inherits the global default). See
    // server/services/quotaService.ts for the resolution order.
    quotaActiveLimit: z.number().int().positive().nullable().optional(),
    quotaWeeklyLimit: z.number().int().positive().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

async function activeAdminCount(): Promise<number> {
  return prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
}

usersRouter.get('/', async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid query parameters'
      );
    }
    const { limit, offset } = parsed.data;
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: limit,
      }),
      prisma.user.count(),
    ]);
    res.json({ users: rows.map(toPublicUser), total });
  } catch (err) {
    next(err);
  }
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }
    const { password } = parsed.data;
    const username = normalizeUsername(parsed.data.username);
    const role = parsed.data.role ?? 'USER';

    validatePasswordStrength(password);

    const passwordHash = await hashPassword(password);

    try {
      const created = await prisma.user.create({
        data: { username, passwordHash, role, isActive: true },
      });
      res.status(201).json(toPublicUser(created));
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictError('Username already exists');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

usersRouter.get('/:id', async (req, res, next) => {
  try {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) throw new NotFoundError('User not found');
    const user = await prisma.user.findUnique({ where: { id: parsed.data.id } });
    if (!user) throw new NotFoundError('User not found');
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

usersRouter.patch('/:id', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');

    const idParsed = idParamSchema.safeParse(req.params);
    if (!idParsed.success) throw new NotFoundError('User not found');
    const id = idParsed.data.id;

    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('User not found');

    const data: Prisma.UserUpdateInput = {};
    if (parsed.data.username) data.username = normalizeUsername(parsed.data.username);
    if (parsed.data.password) {
      validatePasswordStrength(parsed.data.password);
      data.passwordHash = await hashPassword(parsed.data.password);
    }
    if (parsed.data.role) data.role = parsed.data.role;
    if (typeof parsed.data.isActive === 'boolean') data.isActive = parsed.data.isActive;
    if (parsed.data.quotaActiveLimit !== undefined) {
      data.quotaActiveLimit = parsed.data.quotaActiveLimit;
    }
    if (parsed.data.quotaWeeklyLimit !== undefined) {
      data.quotaWeeklyLimit = parsed.data.quotaWeeklyLimit;
    }

    // Self-deactivate guard.
    if (id === req.user.id && data.isActive === false) {
      throw new ValidationError('You cannot deactivate your own account');
    }
    if (id === req.user.id && data.role && data.role !== 'ADMIN') {
      throw new ValidationError('You cannot demote your own account');
    }

    // Last-admin guard. Only relevant if existing user is an active admin AND
    // the patch would either deactivate them or change their role away.
    const wouldRemoveAdmin =
      existing.role === 'ADMIN' &&
      existing.isActive &&
      ((data.role !== undefined && data.role !== 'ADMIN') ||
        data.isActive === false);
    if (wouldRemoveAdmin) {
      const adminCount = await activeAdminCount();
      if (adminCount <= 1) {
        throw new ValidationError('Cannot remove the last active admin');
      }
    }

    try {
      const updated = await prisma.user.update({ where: { id }, data });
      res.json(toPublicUser(updated));
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictError('Username already exists');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

usersRouter.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');

    const idParsed = idParamSchema.safeParse(req.params);
    if (!idParsed.success) throw new NotFoundError('User not found');
    const id = idParsed.data.id;

    if (id === req.user.id) {
      throw new ValidationError('You cannot delete your own account');
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('User not found');

    if (existing.role === 'ADMIN' && existing.isActive) {
      const adminCount = await activeAdminCount();
      if (adminCount <= 1) {
        throw new ValidationError('Cannot delete the last active admin');
      }
    }

    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default usersRouter;
