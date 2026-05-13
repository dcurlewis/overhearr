import { expect, test } from '@playwright/test';
import {
  installApiMocks,
  mockHappyPath,
  mockLastfmNotConfigured,
} from './_fixtures/mocks';
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

  test('Last.fm not configured shows empty state with admin CTA', async ({
    page,
  }) => {
    await mockLastfmNotConfigured(page);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /set up last\.fm/i })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /open settings/i })
    ).toBeVisible();
    await freezeUi(page);
    await capture(page, '09-discover-not-configured');
  });

  test('non-admin sees not-configured but no Open Settings CTA', async ({
    page,
  }) => {
    await installApiMocks(page, {
      user: {
        id: 2,
        username: 'alice',
        role: 'USER',
        isActive: true,
        createdAt: '2026-05-02T12:00:00.000Z',
        updatedAt: '2026-05-13T08:00:00.000Z',
      } as unknown as import('../../src/types/api').PublicUser,
      discover: {
        configured: false,
        topAlbums: [],
        topArtists: [],
        newReleases: [],
      },
    });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /set up last\.fm/i })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /open settings/i })
    ).toHaveCount(0);
  });
});
