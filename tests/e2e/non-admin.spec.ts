import { expect, test } from '@playwright/test';
import { mockAsRegularUser } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';

test.describe('Non-admin route guards', () => {
  test('non-admin sidebar omits Settings/Users; admin routes redirect', async ({
    page,
  }) => {
    await mockAsRegularUser(page);

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /top albums/i })
    ).toBeVisible();

    // Sidebar items: Discover, Search, Requests — but no Settings or Users.
    await expect(
      page.getByRole('link', { name: /^discover$/i })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^search$/i })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^requests$/i })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^settings$/i })
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /^users$/i })
    ).toHaveCount(0);
    await freezeUi(page);
    await capture(page, '24-non-admin-no-sidebar-admin-items');

    // Direct visits to admin routes should redirect to /.
    await page.goto('/settings');
    await page.waitForURL(/\/$/, { timeout: 5_000 });

    await page.goto('/users');
    await page.waitForURL(/\/$/, { timeout: 5_000 });
  });
});
