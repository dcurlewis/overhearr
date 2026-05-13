import { defineConfig, devices } from '@playwright/test';

const PORT = 5056;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/__screenshots__/',
  snapshotDir: './tests/e2e/__screenshots__/',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The dev server's helmet() default CSP (script-src 'self') blocks the
    // inline scripts Next.js relies on in dev. We don't have a real-browser
    // alternative for that in dev, so tell Playwright to bypass CSP — this
    // affects only the test browser, not production behaviour.
    bypassCSP: true,
    // Force dark color scheme so the app's matchMedia detection sees `dark`
    // by default — gives stable starting state for theme tests.
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Desktop runs every spec EXCEPT mobile.spec.ts.
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      // Mobile project runs ONLY mobile.spec.ts.
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
