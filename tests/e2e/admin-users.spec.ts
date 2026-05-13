import { expect, test } from '@playwright/test';
import { mockHappyPath } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';

test.describe('Admin users page', () => {
  test('list, create user, and self-delete is blocked in the UI', async ({
    page,
  }) => {
    await mockHappyPath(page);

    await page.goto('/users');
    await expect(
      page.getByRole('heading', { name: 'Users', exact: true })
    ).toBeVisible();
    await expect(
      page.locator('table').getByText('admin').first()
    ).toBeVisible();
    await expect(
      page.locator('table').getByText('alice').first()
    ).toBeVisible();
    await freezeUi(page);
    await capture(page, '19-users-list');

    // Create a new user.
    await page.getByRole('button', { name: /^create user$/i }).click();
    await expect(
      page.getByRole('heading', { name: /^create user$/i })
    ).toBeVisible();
    await page.getByLabel('Username').fill('bob');
    await page.getByLabel('Password').fill('correctpassword1');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    // Modal closes once the request resolves.
    await expect(
      page.getByRole('heading', { name: /^create user$/i })
    ).toBeHidden();
    await capture(page, '20-users-created');

    // Open the action menu for the current admin (yourself). The Delete
    // entry is disabled for self — surface that to the screenshot.
    await page
      .locator('table')
      .getByRole('button', { name: /actions for admin/i })
      .click();
    const deleteItem = page
      .getByRole('menuitem', { name: /delete/i })
      .first();
    await expect(deleteItem).toBeVisible();
    // Headless UI disables the menu item via aria-disabled=true.
    await expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
    await capture(page, '21-users-self-delete-blocked');
  });
});
