import { test, expect } from '@playwright/test';

test.describe('Bottom Bar & Console', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('bottom bar is visible with console button', async ({ page }) => {
    const bottomBar = page.locator('[data-testid="bottom-bar"]');
    await expect(bottomBar).toBeVisible();
    await expect(bottomBar.locator('text=Console')).toBeVisible();
  });

  test('console panel toggles on click', async ({ page }) => {
    const consoleBtn = page.locator('[data-testid="bottom-bar"]').locator('text=Console');
    await consoleBtn.click();
    await expect(page.locator('[data-testid="console-panel"]')).toBeVisible();

    // Close via button
    await consoleBtn.click();
    await expect(page.locator('[data-testid="console-panel"]')).not.toBeVisible();
  });

  test('console panel has clear button', async ({ page }) => {
    const consoleBtn = page.locator('[data-testid="bottom-bar"]').locator('text=Console');
    await consoleBtn.click();
    await expect(page.locator('[data-testid="console-clear"]')).toBeVisible();
  });
});
