/**
 * /api/requests — request creation, listing, retry, deletion + admin
 * manual reconciliation trigger.
 *
 * All routes require auth + setup-complete. Mutating endpoints additionally
 * require the X-Overhearr-CSRF header. Admin-scope listing
 * (`?scope=all`) and the manual reconciliation endpoint require the ADMIN
 * role.
 *
 * Request creation (POST /album, POST /artist) returns 200, not 201,
 * because the operation is idempotent: re-requesting an in-flight album
 * yields the same row, and retrying a FAILED row mutates it in place.
 */

import { Router } from 'express';
import { z } from 'zod';

import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../lib/errors';
import { requireAuth, requireSetupComplete } from '../middleware/auth';
import { requireCsrfHeader } from '../middleware/csrf';
import {
  createAlbumRequest,
  createArtistRequest,
  deleteRequest,
  getRequest,
  listRequests,
  retryRequest,
} from '../services/requestService';
import { runReconciliationOnce } from '../services/reconciliationWorker';
import { RequestStatusEnum, RequestTypeEnum } from '../types/domain';

export const requestsRouter = Router();

requestsRouter.use(requireAuth);
requestsRouter.use(requireSetupComplete);

// ---- Schemas --------------------------------------------------------------

// MBIDs are 36 chars in canonical form, but Lidarr (and our search results
// at times) carry shortened or non-canonical ids — accept any non-empty
// string up to a reasonable length and let the upstream resolve it.
const mbidBodySchema = z.object({
  mbid: z
    .string()
    .min(1, 'mbid is required')
    .max(128, 'mbid is too long'),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: RequestStatusEnum.optional(),
  type: RequestTypeEnum.optional(),
  scope: z.enum(['mine', 'all']).default('mine'),
});

// ---- Manual reconcile (admin) --------------------------------------------
//
// Mounted before the `:id` routes so the literal underscore-prefixed path
// can never collide with a numeric id parse.

requestsRouter.post(
  '/_reconcile',
  requireCsrfHeader,
  async (req, res, next) => {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      if (req.user.role !== 'ADMIN') {
        throw new ForbiddenError('Admin role required');
      }
      const summary = await runReconciliationOnce();
      res.json(summary);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Album / Artist creation ---------------------------------------------

requestsRouter.post('/album', requireCsrfHeader, async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const parsed = mbidBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }
    const row = await createAlbumRequest(
      req.user.id,
      parsed.data.mbid,
      req.user.role === 'ADMIN'
    );
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
});

requestsRouter.post('/artist', requireCsrfHeader, async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const parsed = mbidBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }
    const row = await createArtistRequest(
      req.user.id,
      parsed.data.mbid,
      req.user.role === 'ADMIN'
    );
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
});

// ---- List + Get ----------------------------------------------------------

requestsRouter.get('/', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid query parameters'
      );
    }
    const { limit, offset, status, type, scope } = parsed.data;
    const result = await listRequests({
      userId: req.user.id,
      isAdmin: req.user.role === 'ADMIN',
      scope,
      limit,
      offset,
      status,
      type,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

requestsRouter.get('/:id', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) throw new NotFoundError('Request not found');
    const row = await getRequest(
      parsed.data.id,
      req.user.id,
      req.user.role === 'ADMIN'
    );
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// ---- Retry + Delete ------------------------------------------------------

requestsRouter.post(
  '/:id/retry',
  requireCsrfHeader,
  async (req, res, next) => {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) throw new NotFoundError('Request not found');
      const row = await retryRequest(
        req.user.id,
        req.user.role === 'ADMIN',
        parsed.data.id
      );
      res.json(row);
    } catch (err) {
      next(err);
    }
  }
);

requestsRouter.delete(
  '/:id',
  requireCsrfHeader,
  async (req, res, next) => {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) throw new NotFoundError('Request not found');
      await deleteRequest(
        parsed.data.id,
        req.user.id,
        req.user.role === 'ADMIN'
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default requestsRouter;
