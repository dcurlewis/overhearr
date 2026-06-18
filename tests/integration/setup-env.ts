/**
 * Vitest setupFiles hook for integration tests.
 *
 * Runs in each test file's worker BEFORE the test file's static imports
 * are evaluated. We:
 *   1. Set NODE_ENV=test and seed the dev defaults for SESSION_SECRET /
 *      ENCRYPTION_KEY so `server/config/env.ts` validates without real
 *      secrets in CI.
 *   2. Allocate a fresh SQLite DB in a tmpdir and run `prisma migrate deploy`
 *      against it.
 *   3. Set DATABASE_URL to that file BEFORE the test imports `@server/*` —
 *      so the Prisma client singleton attaches to this DB.
 *   4. Register a Vitest afterAll hook (via dynamic import) that disconnects
 *      Prisma and removes the temp dir.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// NODE_ENV is typed read-only by @types/node when @types/next pulls in
// process.env narrow typing. Cast to a plain string-keyed map to bypass.
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'test';
env.SESSION_SECRET ??= 'overhearr-dev-session-secret-change-me-in-production';
env.ENCRYPTION_KEY ??= '00'.repeat(32);
env.LOG_LEVEL ??= 'fatal';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'prisma', 'schema.prisma');

const dir = mkdtempSync(path.join(tmpdir(), 'overhearr-test-'));
const dbDir = path.join(dir, 'db');
mkdirSync(dbDir, { recursive: true });
const dbFile = path.join(dbDir, 'test.db');
const url = `file:${dbFile}`;
env.DATABASE_URL = url;

// Image-proxy cache writes to disk; point it at the per-worker tmp dir so the
// singleton (constructed at module load) never writes under the repo CWD.
const imageCacheDir = path.join(dir, 'cache', 'images');
mkdirSync(imageCacheDir, { recursive: true });
env.IMAGE_CACHE_DIR ??= imageCacheDir;

const prismaBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'prisma');
execFileSync(prismaBin, ['migrate', 'deploy', '--schema', SCHEMA_PATH], {
  env: { ...process.env, DATABASE_URL: url },
  cwd: REPO_ROOT,
  stdio: 'pipe',
});

afterAll(async () => {
  try {
    const { prisma } = await import('../../server/db/prisma');
    await prisma.$disconnect();
  } catch {
    // ignore — prisma may not have been imported
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
