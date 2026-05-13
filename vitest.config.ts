import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/integration/setup-env.ts'],
    include: [
      'tests/unit/**/*.{test,spec}.{ts,tsx}',
      'tests/integration/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['node_modules', 'dist', '.next', 'tests/e2e/**'],
    // Per-file overrides: frontend unit tests need jsdom for window/document.
    environmentMatchGlobs: [
      ['tests/unit/frontend/**/*.{test,spec}.{ts,tsx}', 'jsdom'],
    ],
    // Each integration test file allocates its own SQLite DB and migrates
    // before importing the app. Use forked workers so each file gets a
    // clean module-eval (independent Prisma client + env load).
    pool: 'forks',
    poolOptions: {
      forks: { isolate: true },
    },
    isolate: true,
    // Lidarr msw tests have a few slow scenarios (rate-limit retry windows,
    // large fixture parsing). 15s gives them headroom without masking hangs.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['server/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '.next/**',
        'coverage/**',
        'tests/**',
        '**/*.d.ts',
        'prisma/**',
        '**/generated/prisma/**',
        '**/_*.ts',
        'playwright.config.ts',
        'vitest.config.ts',
        'next.config.js',
        'tailwind.config.js',
        'postcss.config.js',
        'next-env.d.ts',
        'src/pages/_app.tsx',
        'src/pages/_document.tsx',
        'src/types/**',
        'server/types/**',
      ],
      // Global thresholds only — perFile is too noisy for v1, where some
      // pages are exercised by Playwright (Phase 6b) rather than vitest.
      //
      // Threshold rationale: server/ code (the core of the application —
      // auth, settings, Lidarr/MusicBrainz/Last.fm clients, reconciliation,
      // request lifecycle) sits comfortably above 90% lines/branches under
      // vitest. The frontend (src/pages, src/components, src/context,
      // src/hooks) is *intentionally* unexercised by vitest in v1 — it is
      // covered end-to-end by Playwright (Phase 6b). That deliberately
      // pulls the *global* line/statement averages down to ~43%, even
      // though the unit-tested portion is ~95%. We set conservative global
      // floors here so a regression in the tested surface still trips the
      // build, without forcing makework unit tests for components Playwright
      // already exercises.
      thresholds: {
        lines: 40,
        functions: 70,
        branches: 70,
        statements: 40,
        perFile: false,
      },
    },
  },
});
