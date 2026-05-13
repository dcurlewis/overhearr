import { expect, test } from '@playwright/test';
import { installApiMocks } from './_fixtures/mocks';
import { capture, freezeUi } from './_fixtures/screenshot';

test.describe('Login / logout', () => {
  test('login with wrong then correct password, then logout', async ({
    page,
  }) => {
    // Start logged out, but setup completed (admin exists).
    const handle = await installApiMocks(page, { user: null });

    await page.goto('/');
    // Guard should redirect to /login.
    await expect(page).toHaveURL(/\/login$/);

    await freezeUi(page);
    await capture(page, '07-login');

    // Wrong password.
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid username or password/i)).toBeVisible();

    // Correct password.
    await page.getByLabel('Password').fill('correctpassword1');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Redirected to home.
    await page.waitForURL(/\/$/);
    expect(handle.state.user?.username).toBe('admin');

    // Logout via user menu.
    await page.getByRole('button', { name: /admin/i }).first().click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await page.waitForURL(/\/login$/);
    expect(handle.state.user).toBeNull();
  });
});
