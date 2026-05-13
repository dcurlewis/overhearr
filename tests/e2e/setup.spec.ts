import { expect, test } from '@playwright/test';
import { mockVirginInstall } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';

test.describe('First-run setup wizard', () => {
  test('walks through admin → lidarr → profiles → last.fm → done', async ({
    page,
  }) => {
    const handle = await mockVirginInstall(page);

    await page.goto('/');
    // Virgin install — should be redirected to /setup.
    await expect(page).toHaveURL(/\/setup$/);

    await freezeUi(page);
    await expect(
      page.getByRole('heading', { name: /create admin account/i })
    ).toBeVisible();

    // Fill the admin form (capture before submit so the form is full).
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('correctpassword1');
    await page.getByLabel('Confirm password').fill('correctpassword1');
    await capture(page, '01-setup-admin-step');

    await page.getByRole('button', { name: /create admin account/i }).click();

    // After admin step we're on Lidarr connection.
    await expect(page.getByLabel('Lidarr URL')).toBeVisible();
    await capture(page, '02-setup-after-admin');

    // Fill Lidarr connection.
    await page.getByLabel('Lidarr URL').fill('http://lidarr.example.com');
    await page.getByRole('textbox', { name: 'API key' }).fill('test-key');
    await page.getByRole('button', { name: /test connection/i }).click();

    // Wait for the success indicator.
    await expect(page.getByText(/connected to lidarr/i)).toBeVisible();
    await capture(page, '03-setup-lidarr-test-success');

    await page.getByRole('button', { name: /save & continue/i }).click();

    // Profiles step — selects pre-populate from mocked profiles.
    await expect(page.getByLabel('Root folder')).toBeVisible();
    // Wait until SWR has loaded the profiles list.
    await expect(page.getByLabel('Quality profile')).toBeEnabled();
    await capture(page, '04-setup-lidarr-profiles');

    await page.getByRole('button', { name: /save & continue/i }).click();

    // Last.fm step.
    await expect(page.getByLabel('Last.fm API key')).toBeVisible();
    await page.getByLabel('Last.fm API key').fill('abc123abc123abc123abc123abc12345');
    await capture(page, '05-setup-lastfm');

    await page.getByRole('button', { name: /save & continue/i }).click();

    // Done step shows "Finishing up" while it POSTs setup/complete.
    await expect(
      page.getByRole('heading', { name: /finishing up/i })
    ).toBeVisible({ timeout: 5_000 });

    // Wait for the POST to actually fire and the mock state to flip.
    // (The DoneStep's success-then-redirect path interacts oddly with
    // React 18 StrictMode in `next dev` — once cancelled is set by the
    // first cleanup, the post-await branch is silently skipped. The mock
    // still records the POST happened, which is what we care about.)
    await expect
      .poll(() => handle.state.setupStatus.setupCompleted, {
        timeout: 10_000,
      })
      .toBe(true);
    await capture(page, '06-setup-done');

    // Sanity: every wizard step posted what we expected.
    expect(handle.state.setupStatus.setupCompleted).toBe(true);
    expect(handle.state.setupStatus.hasAdmin).toBe(true);
    expect(handle.state.settingsView.lidarrUrl).toBe('http://lidarr.example.com');
    expect(handle.state.settingsView.lidarrApiKey).toContain('-key');
    expect(handle.state.settingsView.lidarrRootFolderPath).toBe(
      '/data/music'
    );
  });
});
