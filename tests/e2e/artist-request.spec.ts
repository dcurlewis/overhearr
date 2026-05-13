import { expect, test } from '@playwright/test';
import { mockHappyPath } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';
import { RADIOHEAD_MBID } from './_fixtures/data';

test.describe('Artist request flow', () => {
  test('artist detail → confirm modal → request whole discography', async ({
    page,
  }) => {
    await mockHappyPath(page);

    await page.goto(`/artist/${RADIOHEAD_MBID}`);
    await expect(
      page.getByRole('heading', { name: 'Radiohead' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /discography/i })
    ).toBeVisible();
    await expect(page.getByText('In Rainbows').first()).toBeVisible();
    await freezeUi(page);
    await capture(page, '14-artist-detail');

    // Open confirm modal — click the page-level Request button (size=lg) in
    // the hero, NOT the discography per-album buttons (size=sm).
    await page
      .getByRole('button', { name: 'Request', exact: true })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: /request entire artist/i })
    ).toBeVisible();
    await capture(page, '15-artist-confirm-modal');

    // Confirm.
    await page.getByRole('button', { name: /^request artist$/i }).click();

    // Modal closes; the page-level request button should flip to a
    // disabled state since artistRequestProcessing returns PROCESSING.
    await expect(
      page.getByRole('heading', { name: /request entire artist/i })
    ).toBeHidden();
    await capture(page, '16-artist-requested');
  });
});
