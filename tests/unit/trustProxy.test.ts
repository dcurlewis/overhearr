/**
 * Verifies `appFactory.ts` translates the boolean `TRUST_PROXY` env var into
 * Express's `trust proxy` setting:
 *
 *   TRUST_PROXY=false → false  (no X-Forwarded-* trust)
 *   TRUST_PROXY=true  → 1      (trust ONE upstream hop)
 *
 * Regression guard: passing `true` literally would mean "trust every hop",
 * which is a security smell (X-Forwarded-For spoofing) AND triggers the
 * express-rate-limit `ERR_ERL_PERMISSIVE_TRUST_PROXY` advisory on every
 * startup. Issue #13.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to vary the imported `env.TRUST_PROXY` per-test, which means
// re-importing `appFactory` after re-mocking `env`. `vi.resetModules()`
// between cases gives us a clean slate.

const ENV_PATH = '../../server/config/env';
const APP_FACTORY_PATH = '../../server/appFactory';

function mockEnv(trustProxy: boolean): void {
  vi.doMock(ENV_PATH, () => ({
    env: {
      NODE_ENV: 'test',
      PORT: 5056,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: 'file::memory:',
      TRUST_PROXY: trustProxy,
      SESSION_SECRET:
        'overhearr-dev-session-secret-change-me-in-production',
      ENCRYPTION_KEY: '00'.repeat(32),
    },
    isProduction: false,
    isDevelopment: false,
    isTest: true,
  }));
}

describe('appFactory trust-proxy mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock(ENV_PATH);
    vi.resetModules();
  });

  it('TRUST_PROXY=false → app.get("trust proxy") === false', async () => {
    mockEnv(false);
    const { buildApp } = await import(APP_FACTORY_PATH);
    const { app } = buildApp();
    expect(app.get('trust proxy')).toBe(false);
  });

  it('TRUST_PROXY=true → app.get("trust proxy") === 1 (NOT true)', async () => {
    mockEnv(true);
    const { buildApp } = await import(APP_FACTORY_PATH);
    const { app } = buildApp();
    // Express stores the boolean-true case as `true`. We deliberately set the
    // numeric `1` so this assertion catches a regression where someone
    // "simplifies" the ternary back to `app.set('trust proxy', env.TRUST_PROXY)`.
    expect(app.get('trust proxy')).toBe(1);
  });
});
