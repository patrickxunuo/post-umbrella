import { test, expect } from '@playwright/test';

test.describe('Smoke Test', () => {
  test('app loads and shows main interface', async ({ page }) => {
    await page.goto('/');

    // Wait for app to load - workspace selector should be visible
    await expect(page.locator('.workspace-selector')).toBeVisible({ timeout: 10000 });

    // Should see the sidebar
    await expect(page.locator('.sidebar')).toBeVisible();

    // Should see the main header
    await expect(page.locator('.app-header')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/smoke-main.png' });
  });
});
