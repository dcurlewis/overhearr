/**
 * Screenshot helpers for the Phase 8 final report.
 *
 * Two concerns are bundled here:
 * - Disable transitions/animations so screenshots are stable.
 * - A single `capture()` helper that writes PNGs into
 *   `tests/e2e/__screenshots__/` using a flat, numbered convention so the
 *   report generator can pick them up by filename.
 */

import path from 'node:path';
import type { Page } from '@playwright/test';

const OUT_DIR = path.resolve(
  __dirname,
  '..',
  '__screenshots__'
);

const FREEZE_CSS = `
  *, *::before, *::after {
    transition: none !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; }
`;

/**
 * Run before any capture(). Reduces motion + injects a CSS reset that
 * disables every transition/animation on the page.
 */
export async function freezeUi(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: FREEZE_CSS });
  // Wait for any in-flight network idle to settle so cards aren't mid-fade.
  await page.waitForLoadState('networkidle').catch(() => {
    // Some pages (e.g. with a long polling SWR) never reach networkidle —
    // best effort is fine.
  });
}

export async function capture(
  page: Page,
  name: string,
  opts: { fullPage?: boolean } = {}
): Promise<string> {
  const fullPage = opts.fullPage ?? true;
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage, animations: 'disabled' });
  return file;
}
