import rateLimit from 'express-rate-limit';

import { isTest } from '../config/env';

/**
 * Rate limiter for the login endpoint and the one-shot setup-initialize
 * endpoint. 10 attempts per minute per IP, counts both failures and
 * successes (legitimate users will not approach this).
 *
 * In-memory store is appropriate for v1 — Overhearr ships as a single-process
 * Docker container.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  // In tests we bypass the limiter on a per-test-suite basis. The `skip`
  // function below is invoked per request; we expose a flag on the request
  // to allow specific tests to opt back into rate limiting.
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skip: (req) => {
    if (isTest && req.headers['x-test-disable-rate-limit'] === '1') return true;
    return false;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, try again later.',
      },
    });
  },
});
