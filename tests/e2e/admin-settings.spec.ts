import { expect, test } from '@playwright/test';
import { mockHappyPath } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';

test.describe('Admin settings page', () => {
  test('shows Lidarr / Last.fm / System cards with redacted secrets', async ({
    page,
  }) => {
    await mockHappyPath(page);

    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Settings' })
    ).toBeVisible();
    // Three cards are rendered (System, Lidarr, Last.fm).
    await expect(
      page.getByText('System', { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText('Lidarr', { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText('Last.fm', { exact: true }).first()
    ).toBeVisible();

    // The Lidarr API key field shows the redacted value, NOT the raw key.
    await expect(page.getByText('••••••••t-key')).toBeVisible();
    await freezeUi(page);
    await capture(page, '22-settings');

    // Test the connection. Click Change on the Lidarr card (the first one)
    // to enter the key, fill, then Test.
    await page
      .getByRole('button', { name: /^change$/i })
      .first()
      .click();
    await page.getByLabel('New API key').fill('new-test-key');
    await page.getByRole('button', { name: /test connection/i }).click();
    // Mock returns ok=true with version 2.10.4 — toast + inline indicator.
    await expect(page.getByText(/connected.*2\.10\.4/i).first()).toBeVisible();
    await capture(page, '23-settings-test-success');
  });
});
