import 'dotenv/config';
import 'express-async-errors';

import next from 'next';
import { readFileSync } from 'fs';
import path from 'path';

import { buildApp } from './appFactory';
import { env, isProduction } from './config/env';
import { prisma } from './db/prisma';
import { logger } from './lib/logger';
import { PrismaSessionStore } from './middleware/sessionStore';
import {
  startReconciliationLoop,
  stopReconciliationLoop,
} from './services/reconciliationWorker';
import {
  startLibrarySyncLoop,
  stopLibrarySyncLoop,
} from './services/librarySyncWorker';

function readVersion(): string {
  // Try a couple of locations so this works whether the compiled layout is
  // `dist/index.js` or `dist/server/index.js` (tsc's emit path depends on
  // rootDir / which other source roots are in the project).
  const candidates = [
    path.resolve(__dirname, '../package.json'),
    path.resolve(__dirname, '../../package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === 'overhearr' && parsed.version) return parsed.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}

async function main(): Promise<void> {
  const version = readVersion();

  logger.info(
    {
      version,
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      host: env.HOST,
      logLevel: env.LOG_LEVEL,
      trustProxy: env.TRUST_PROXY,
    },
    `starting Overhearr v${version}`
  );

  // 1. Database
  await prisma.$connect();
  logger.info('prisma: connected');

  // 2. Next.js
  const nextApp = next({ dev: !isProduction, dir: process.cwd() });
  await nextApp.prepare();
  const nextHandler = nextApp.getRequestHandler();
  logger.info({ dev: !isProduction }, 'next.js: prepared');

  // 3. Express via factory
  const sessionStore = new PrismaSessionStore();
  const { app } = buildApp({
    sessionStore,
    attachExtraHandlers: (a) => {
      // Non-/api routes fall through to Next.js. This runs after the
      // /api/* 404 but before the error handler.
      a.all('*', (req, res) => nextHandler(req, res));
    },
  });

  // 4. Listen
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(`listening on http://${env.HOST}:${env.PORT}`);
    // 4b. Background reconciliation loop. The worker is a no-op in
    // NODE_ENV=test (tests call runReconciliationOnce() directly), so we
    // can call this unconditionally here.
    startReconciliationLoop();
    // 4c. Background library-sync loop — mirrors Lidarr's `/album` into
    // LidarrLibraryAlbum so search/discover responses can flag rows the
    // user already owns. Same NODE_ENV=test no-op.
    startLibrarySyncLoop();
  });

  // 5. Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown: signal received, draining...');

    const forceExit = setTimeout(() => {
      logger.error('shutdown: timeout exceeded, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      // Stop the background loops BEFORE closing the HTTP server so a
      // tick mid-shutdown can't issue queries against a torn-down Prisma.
      stopReconciliationLoop();
      stopLibrarySyncLoop();
      logger.info('shutdown: background loops stopped');

      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info('shutdown: http server closed');

      sessionStore.stopCleanup();
      await prisma.$disconnect();
      logger.info('shutdown: prisma disconnected');

      clearTimeout(forceExit);
      logger.info('shutdown: clean exit');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown: error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
