import { expect, test } from '@playwright/test';
import { mockHappyPath } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';

test.describe('Theme toggle', () => {
  test('flips between light and dark, and persists across reload', async ({
    page,
  }) => {
    await mockHappyPath(page);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /top albums/i })
    ).toBeVisible();
    await freezeUi(page);

    // Default is dark (server-side default in ThemeContext).
    await expect(page.locator('html')).toHaveClass(/dark/);
    await capture(page, '26-theme-dark');

    // Toggle to light.
    await page.getByRole('button', { name: /switch to light theme/i }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await capture(page, '25-theme-light');

    // Reload — the choice should persist via localStorage.
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
