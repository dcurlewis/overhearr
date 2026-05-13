import { expect, test } from '@playwright/test';
import { mockRequestsWithFailure } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';

test.describe('Retry failed request', () => {
  test('FAILED row shows error then retries to PROCESSING', async ({
    page,
  }) => {
    await mockRequestsWithFailure(page);

    await page.goto('/requests');
    await expect(
      page.getByRole('heading', { name: /my requests/i })
    ).toBeVisible();
    await expect(
      page.locator('table').getByText('Doolittle').first()
    ).toBeVisible();
    await expect(
      page.locator('table').getByText('Failed').first()
    ).toBeVisible();
    await freezeUi(page);
    await capture(page, '17-requests-failed');

    // Click the row's Retry button (use the desktop table layout).
    const doolittleRow = page
      .locator('table')
      .locator('tr', { hasText: 'Doolittle' });
    await doolittleRow.getByRole('button', { name: /retry/i }).click();

    // After retry, the row should flip to a "processing" badge.
    await expect(doolittleRow.getByText(/processing/i)).toBeVisible({
      timeout: 5_000,
    });
    await capture(page, '18-requests-retried');
  });
});
