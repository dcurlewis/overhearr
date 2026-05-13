import 'express-async-errors';

import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import session from 'express-session';
import helmet from 'helmet';

import { env, isProduction } from './config/env';
import { apiNotFoundHandler, errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { PrismaSessionStore } from './middleware/sessionStore';
import { authRouter } from './routes/auth';
import { discoverRouter } from './routes/discover';
import { healthRouter } from './routes/health';
import { albumRouter, artistRouter } from './routes/music';
import { profileRouter } from './routes/profile';
import { requestsRouter } from './routes/requests';
import { searchRouter } from './routes/search';
import { settingsRouter } from './routes/settings';
import { setupRouter } from './routes/setup';
import { usersRouter } from './routes/users';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface BuildAppOptions {
  /**
   * Provide a pre-built session store. Tests can pass a fresh
   * PrismaSessionStore so they control its cleanup timer lifecycle.
   * If omitted, a fresh PrismaSessionStore is constructed.
   */
  sessionStore?: session.Store;
  /**
   * Optional callback invoked after API routes are mounted but before the
   * API 404 / error handler. The runtime entry point uses this to mount
   * the Next.js request handler so that non-/api requests fall through.
   */
  attachExtraHandlers?: (app: Express) => void;
}

export interface BuiltApp {
  app: Express;
  sessionStore: session.Store;
}

/**
 * Builds the Express app with all middleware, session, and API routers wired
 * up. Does NOT connect Prisma or call `listen` — those are caller
 * responsibilities (see `server/index.ts`). This separation lets integration
 * tests boot the API surface in isolation.
 */
export function buildApp(options: BuildAppOptions = {}): BuiltApp {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger);
  // Helmet defaults are too strict for a Next.js app served over plain HTTP
  // behind an optional reverse proxy:
  //  - The default CSP ('script-src self') blocks Next's inline hydration
  //    scripts and our FOUC theme suppression script in _document.tsx.
  //  - cross-origin-opener-policy and origin-agent-cluster require HTTPS to
  //    take effect; over HTTP they log noisy console warnings.
  // We keep everything else helmet hardens (X-Frame-Options, no-sniff, etc).
  // For a public-internet deploy, terminate TLS at a reverse proxy (nginx,
  // Caddy, Cloudflare) and let it set its own CSP / HSTS / COOP headers.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  const sessionStore = options.sessionStore ?? new PrismaSessionStore();
  app.use(
    session({
      name: 'overhearr.sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: SESSION_MAX_AGE_MS,
      },
    })
  );

  // API routes
  app.use('/api/health', healthRouter);
  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/album', albumRouter);
  app.use('/api/artist', artistRouter);
  app.use('/api/discover', discoverRouter);
  app.use('/api/requests', requestsRouter);

  // 404 for unmatched /api/* routes — non-/api falls through to whatever the
  // caller mounts via attachExtraHandlers (e.g. Next.js).
  app.use('/api', apiNotFoundHandler);

  options.attachExtraHandlers?.(app);

  app.use(errorHandler);

  return { app, sessionStore };
}
