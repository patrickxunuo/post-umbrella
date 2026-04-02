import { test, expect } from '@playwright/test';

test.describe('ErrorBoundary and ConnectionStatus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('EB-001: error boundary fallback is not visible during normal operation', async ({ page }) => {
    // The fallback UI should not be present when the app renders without errors
    const fallback = page.locator('[data-testid="error-boundary-fallback"]');
    await expect(fallback).not.toBeVisible();
  });

  test('EB-002: connection status banner is hidden when connected', async ({ page }) => {
    // The connection status banner should not be visible (or not in DOM) when WebSocket is connected
    const banner = page.locator('[data-testid="connection-status"]');

    const count = await banner.count();
    if (count > 0) {
      await expect(banner).not.toBeVisible();
    }
    // If the element is not in the DOM at all, that also satisfies the requirement
  });
});
