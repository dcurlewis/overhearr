/**
 * Integration test helpers.
 *
 * Per-file SQLite isolation: `setup-env.ts` (a vitest setupFile) runs in
 * each forked worker BEFORE the test file's static imports are evaluated.
 * It allocates a tmp dir, runs `prisma migrate deploy`, and points
 * DATABASE_URL at the new SQLite file — so each integration test file gets
 * its own clean DB and its own Prisma client singleton. Cross-file
 * pollution is impossible by construction (different forks, different env).
 *
 * To add a new integration test:
 *   1. Create `tests/integration/<name>.test.ts`.
 *   2. `import { buildTestApp, clearDb, provisionAdminWithLidarr } from './_helpers'`.
 *   3. In `beforeEach`, call `await clearDb()` then `harness = buildTestApp()`.
 *   4. In `afterEach`, call `harness.store.stopCleanup()`.
 *   5. If you need an authenticated admin session, call
 *      `provisionAdminWithLidarr(harness)` which returns a cookie agent.
 */
import type { Express } from 'express';
import supertest from 'supertest';

import { buildApp } from '../../server/appFactory';
import { prisma } from '../../server/db/prisma';
import { PrismaSessionStore } from '../../server/middleware/sessionStore';

/** Header that disables rate-limit middleware in tests. */
export const RL_BYPASS = { 'x-test-disable-rate-limit': '1' };
/** Header that signals a cross-origin-safe XHR (the app's CSRF check). */
export const CSRF_HEADER = { 'x-overhearr-csrf': '1' };

/** Truncate all app tables. Safe to call between tests. */
export async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
}

export interface TestApp {
  app: Express;
  store: PrismaSessionStore;
  /** Convenience supertest agent with cookie persistence. */
  agent: () => ReturnType<typeof supertest.agent>;
}

export function buildTestApp(): TestApp {
  const store = new PrismaSessionStore();
  const { app } = buildApp({ sessionStore: store });
  return {
    app,
    store,
    agent: () => supertest.agent(app),
  };
}

export const VALID_PASSWORD = 'CorrectHorse1';

/**
 * Provision an admin account, configure Lidarr settings (so the request
 * flow can build a client), and mark setup complete. Returns the
 * cookie-persistent supertest agent for the admin session.
 *
 * The Lidarr `url` is intentionally a host that msw can intercept (the
 * caller is expected to register handlers for `${url}/api/v1/...`).
 */
export async function provisionAdminWithLidarr(
  harness: TestApp,
  options: {
    lidarrUrl?: string;
    apiKey?: string;
  } = {}
): Promise<ReturnType<typeof supertest.agent>> {
  const a = harness.agent();
  await a
    .post('/api/setup/initialize')
    .set(RL_BYPASS)
    .send({ username: 'admin', password: VALID_PASSWORD })
    .expect(201);
  await a
    .patch('/api/settings/lidarr')
    .set(CSRF_HEADER)
    .send({
      url: options.lidarrUrl ?? 'http://test-lidarr.local:8686',
      apiKey: options.apiKey ?? 'test-key',
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 1,
    })
    .expect(200);
  await a.post('/api/setup/complete').set(CSRF_HEADER).send({}).expect(200);
  return a;
}
