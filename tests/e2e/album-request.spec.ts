import { expect, test } from '@playwright/test';
import { mockHappyPath } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';
import {
  IN_RAINBOWS_RG,
  albumRequestProcessing,
  sampleRequests,
} from './_fixtures/data';

test.describe('Album request golden path', () => {
  test('search → detail → request → see in /requests', async ({ page }) => {
    const handle = await mockHappyPath(page);

    // ---- Search --------------------------------------------------------
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
    await page.getByLabel('Search music').fill('in rainbows');

    // Wait for the debounced fetch to settle and results to appear.
    await expect(page.getByText('In Rainbows').first()).toBeVisible({
      timeout: 5_000,
    });
    await freezeUi(page);
    await capture(page, '10-search-results');

    // Click into the In Rainbows album.
    await page.getByText('In Rainbows').first().click();

    // ---- Album detail --------------------------------------------------
    await page.waitForURL(/\/album\//);
    await expect(
      page.getByRole('heading', { name: 'In Rainbows' })
    ).toBeVisible();
    await expect(page.getByText('Weird Fishes/Arpeggi')).toBeVisible();
    await freezeUi(page);
    await capture(page, '11-album-detail');

    // ---- Request -------------------------------------------------------
    // Pre-load the requests list so the next page shows the submitted item.
    handle.setRequests([albumRequestProcessing, ...sampleRequests]);

    await page.getByRole('button', { name: 'Request', exact: true }).click();
    // Button flips to Downloading (PROCESSING) state after revalidation.
    await expect(
      page.getByRole('button', { name: /downloading/i })
    ).toBeVisible({ timeout: 10_000 });
    await capture(page, '12-album-requested');

    // ---- Requests list -------------------------------------------------
    await page.goto('/requests');
    await expect(
      page.getByRole('heading', { name: /my requests/i })
    ).toBeVisible();
    // Two layouts render (mobile cards + desktop table); target the visible one.
    await expect(
      page.locator('table').getByText('In Rainbows').first()
    ).toBeVisible();
    await freezeUi(page);
    await capture(page, '13-requests-list');

    // Sanity: the request has an mbid that matches our fixture.
    expect(albumRequestProcessing.mbid).toBe(IN_RAINBOWS_RG);
  });
});
