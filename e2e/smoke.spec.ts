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

  test('existing collections load after login', async ({ page }) => {
    await page.goto('/');

    // Wait for workspace to be ready
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });

    // Wait for sidebar loading to finish
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });

    // Verify collections actually loaded (not stuck on "No collections yet")
    // Either collections exist OR the empty state shows — but the sidebar must not be in a loading/error state
    const hasCollections = await page.locator('.collection-header').count();
    const hasEmptyState = await page.locator('.sidebar-empty').isVisible();

    // At least one must be true — the app loaded successfully
    expect(hasCollections > 0 || hasEmptyState).toBe(true);

    // If there are collections, verify they have names (not broken renders)
    if (hasCollections > 0) {
      const firstName = await page.locator('.collection-header .collection-name').first().textContent();
      expect(firstName).toBeTruthy();
    }

    await page.screenshot({ path: 'e2e/screenshots/smoke-collections-loaded.png' });
  });
});
