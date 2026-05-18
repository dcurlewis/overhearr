import { expect, test } from '@playwright/test';
import { mockDiscoverEmpty, mockHappyPath } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';

test.describe('Discover', () => {
  test('renders top albums/artists/new releases (light + dark)', async ({
    page,
  }) => {
    await mockHappyPath(page);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /top albums/i })
    ).toBeVisible();
    await expect(page.getByText('In Rainbows').first()).toBeVisible();
    await freezeUi(page);

    // Default theme (dark).
    await capture(page, '08-discover-dark');

    // Toggle to light theme.
    await page.getByRole('button', { name: /switch to light theme/i }).click();
    // Wait for class change to commit.
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await capture(page, '08-discover-light');
  });

  test('renders inline empty-row messages when Discover sources return nothing', async ({
    page,
  }) => {
    await mockDiscoverEmpty(page);
    await page.goto('/');
    // The page header still renders, but each row falls back to an inline
    // "No top albums right now." line because every source came back empty.
    await expect(
      page.getByRole('heading', { name: /top albums/i })
    ).toBeVisible();
    await expect(page.getByText(/no top albums right now/i)).toBeVisible();
    await expect(page.getByText(/no top artists right now/i)).toBeVisible();
    await expect(page.getByText(/no new releases right now/i)).toBeVisible();
    await freezeUi(page);
    await capture(page, '09-discover-empty');
  });
});
