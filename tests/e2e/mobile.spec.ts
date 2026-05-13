import { expect, test } from '@playwright/test';
import { mockHappyPath } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';
import { IN_RAINBOWS_REL } from './_fixtures/data';

test.describe('Mobile layout', () => {
  test('home, sidebar, search, album detail all render on mobile', async ({
    page,
  }) => {
    await mockHappyPath(page);

    // Home page on mobile.
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /top albums/i })
    ).toBeVisible();
    await freezeUi(page);
    await capture(page, '27-mobile-home');

    // Open hamburger menu.
    await page.getByRole('button', { name: /open navigation/i }).click();
    await expect(
      page.getByRole('link', { name: /^discover$/i })
    ).toBeVisible();
    await capture(page, '28-mobile-sidebar');

    // Close drawer.
    await page.getByRole('button', { name: /close navigation/i }).click();

    // Search on mobile.
    await page.goto('/search');
    await page.getByLabel('Search music').fill('in rainbows');
    await expect(page.getByText('In Rainbows').first()).toBeVisible({
      timeout: 5_000,
    });
    await freezeUi(page);
    await capture(page, '29-mobile-search');

    // Album detail on mobile.
    await page.goto(`/album/${IN_RAINBOWS_REL}`);
    await expect(
      page.getByRole('heading', { name: 'In Rainbows' })
    ).toBeVisible();
    await freezeUi(page);
    await capture(page, '30-mobile-album');
  });
});
