import type { RequestHandler } from 'express';

import { ForbiddenError } from '../lib/errors';

/**
 * CSRF protection — custom-header pattern.
 *
 * Why this is sufficient (a.k.a. the "double-submit-with-custom-header lite"
 * approach):
 *
 *   1. Our session cookie is `sameSite=lax`, which already blocks the most
 *      common cross-site form-submission CSRF flow.
 *   2. We additionally require a custom header (`X-Overhearr-CSRF: 1`) on
 *      every state-changing request. Browsers will NOT send custom headers
 *      on cross-origin form posts or simple GETs, and any cross-origin XHR
 *      that tries to set a custom header triggers a CORS preflight which we
 *      do not authorize. Therefore, only same-origin code (i.e. our own
 *      frontend, served from the same Next.js server) can satisfy this
 *      header check.
 *   3. Because the frontend is same-origin, no separate token issuance/
 *      rotation flow is required — the static "1" sentinel is a marker, not
 *      a secret.
 *
 * This is a conscious choice over a stateful CSRF token store. The frontend
 * (Phase 5) sets this header automatically inside its API client.
 *
 * Login and the first-run setup endpoint are intentionally exempt because
 * the user has no session cookie yet at those entry points.
 */
const HEADER_NAME = 'x-overhearr-csrf';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (!MUTATING_METHODS.has(req.method)) return next();

  const value = req.header(HEADER_NAME);
  if (!value) {
    return next(
      new ForbiddenError(
        'Missing CSRF header. Set the X-Overhearr-CSRF header on mutating requests.'
      )
    );
  }
  next();
};
