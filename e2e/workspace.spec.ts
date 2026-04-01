import { test, expect } from '@playwright/test';

test.describe('Workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to finish loading (workspace selector shows actual name, not "Loading...")
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
  });

  test('user can see workspace selector after login', async ({ page }) => {
    // Should see the workspace selector in the header
    await expect(page.locator('.workspace-selector')).toBeVisible();

    // Should show a workspace name, not "Loading..."
    const workspaceLabel = page.locator('.workspace-selector-label');
    await expect(workspaceLabel).toBeVisible();
    await expect(workspaceLabel).not.toHaveText('Loading...');

    await page.screenshot({ path: 'e2e/screenshots/workspace-selector.png' });
  });

  test('user can switch between workspaces', async ({ page }) => {
    // Click workspace selector to open dropdown
    await page.locator('.workspace-selector-trigger').click();

    // Wait for dropdown to appear
    const dropdown = page.locator('.workspace-selector-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/workspace-dropdown.png' });

    // Get list of workspace options
    const workspaceOptions = dropdown.locator('.workspace-selector-option');
    const count = await workspaceOptions.count();

    console.log(`Found ${count} workspace options`);

    if (count > 1) {
      // Get current workspace name
      const currentLabel = await page.locator('.workspace-selector-label').textContent();

      // Find and click a non-selected workspace
      const nonSelectedOption = dropdown.locator('.workspace-selector-option:not(.selected)').first();
      if (await nonSelectedOption.isVisible()) {
        const newWorkspaceName = await nonSelectedOption.locator('.workspace-option-name').textContent();
        await nonSelectedOption.click();

        // Wait for workspace to change
        await page.waitForTimeout(1000);

        // Verify the label changed
        await expect(page.locator('.workspace-selector-label')).toHaveText(newWorkspaceName || '');
        await page.screenshot({ path: 'e2e/screenshots/workspace-switched.png' });
      }
    } else {
      console.log('Only one workspace available, skipping switch test');
    }
  });

  test('session persists after page refresh', async ({ page }) => {
    // Verify we're logged in (not on login page)
    await expect(page.locator('form:has(input[type="email"])')).not.toBeVisible();

    // Wait for workspace to fully load before capturing its name
    const workspaceLabel = page.locator('.workspace-selector-label');
    await expect(workspaceLabel).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(workspaceLabel).not.toHaveText('No Workspace', { timeout: 10000 });

    // Get current workspace name
    const workspaceBefore = await workspaceLabel.textContent();

    // Refresh the page
    await page.reload();

    // Wait for app to load again
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });

    // Should still be logged in (no login form)
    await expect(page.locator('form:has(input[type="email"])')).not.toBeVisible();

    // Should still see the same workspace
    await expect(page.locator('.workspace-selector-label')).toHaveText(workspaceBefore || '');

    await page.screenshot({ path: 'e2e/screenshots/session-persisted.png' });
  });

  test('user can logout', async ({ browser }) => {
    // Use a fresh context + intercept logout API to avoid invalidating shared auth
    const context = await browser.newContext({ storageState: 'e2e/.auth/user.json' });
    const page = await context.newPage();
    await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204 }));

    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });

    // Open user dropdown
    const userMenuTrigger = page.locator('.user-menu-trigger');
    await expect(userMenuTrigger).toBeVisible();
    await userMenuTrigger.click();

    // Verify dropdown shows Sign Out option
    const dropdown = page.locator('.user-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    const signOutBtn = dropdown.locator('.user-dropdown-item.danger');
    await expect(signOutBtn).toBeVisible();
    await expect(signOutBtn).toContainText('Sign Out');

    // Click Sign Out
    await signOutBtn.click();

    // Should show login page
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/logged-out.png' });

    await context.close();
  });
});
