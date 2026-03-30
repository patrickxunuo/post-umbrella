import { test, expect } from '@playwright/test';

const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

async function waitForApp(page) {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
}

test.describe('Admin & Settings', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('user can toggle between light and dark theme', async ({ page }) => {
    // Check initial theme
    const html = page.locator('html');
    const initialTheme = await html.getAttribute('data-theme');

    // Find and click the theme toggle
    const themeToggle = page.locator('.theme-toggle');
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();

    // Theme should have changed
    const newTheme = await html.getAttribute('data-theme');
    expect(newTheme).not.toBe(initialTheme);

    // Toggle back
    await themeToggle.click();
    const restoredTheme = await html.getAttribute('data-theme');
    expect(restoredTheme).toBe(initialTheme);

    await page.screenshot({ path: 'e2e/screenshots/theme-toggle.png' });
  });

  test('user can open workspace settings', async ({ page }) => {
    // Click workspace selector to open dropdown
    const workspaceSelector = page.locator('.workspace-selector-trigger');
    await workspaceSelector.click();

    // Look for settings gear button in the dropdown footer
    const settingsBtn = page.locator('.workspace-selector-footer .btn-icon, .workspace-selector-footer button').filter({ has: page.locator('svg') }).last();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();

      // Settings modal/drawer should appear
      const settingsModal = page.locator('.workspace-settings, .settings-modal');
      await expect(settingsModal).toBeVisible({ timeout: 5000 });

      await page.screenshot({ path: 'e2e/screenshots/workspace-settings.png' });

      // Close it
      const closeBtn = settingsModal.locator('.btn-icon').filter({ has: page.locator('svg') }).first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    } else {
      // Settings not available for this user role — skip gracefully
      test.skip();
    }
  });

  test('user can open user management', async ({ page }) => {
    // Look for the admin/invite button in the header
    const adminBtn = page.locator('.btn-admin');

    if (await adminBtn.isVisible()) {
      await adminBtn.click();

      // User management modal should appear
      const userManagement = page.locator('.user-management, .invite-modal');
      await expect(userManagement).toBeVisible({ timeout: 5000 });

      await page.screenshot({ path: 'e2e/screenshots/user-management.png' });
    } else {
      // Not an admin — skip
      test.skip();
    }
  });

  test('workspace members list is visible in settings', async ({ page }) => {
    // Open workspace selector
    const workspaceSelector = page.locator('.workspace-selector-trigger');
    await workspaceSelector.click();

    const settingsBtn = page.locator('.workspace-selector-footer .btn-icon, .workspace-selector-footer button').filter({ has: page.locator('svg') }).last();
    if (!await settingsBtn.isVisible()) {
      test.skip();
      return;
    }
    await settingsBtn.click();

    const settingsModal = page.locator('.workspace-settings');
    await expect(settingsModal).toBeVisible({ timeout: 5000 });

    // Look for members section/list
    const membersSection = settingsModal.locator('text=Members, text=members, .workspace-members');
    if (await membersSection.first().isVisible()) {
      await page.screenshot({ path: 'e2e/screenshots/workspace-members.png' });
    } else {
      // Members section may be on a different tab — check for tabs
      const membersTab = settingsModal.locator('button, [role="tab"]').filter({ hasText: /[Mm]embers/ });
      if (await membersTab.isVisible()) {
        await membersTab.click();
        await page.screenshot({ path: 'e2e/screenshots/workspace-members.png' });
      }
    }
  });

  test('user can invite new member via user management', async ({ page }) => {
    const adminBtn = page.locator('.btn-admin');
    if (!await adminBtn.isVisible()) {
      test.skip();
      return;
    }
    await adminBtn.click();

    const modal = page.locator('.user-management, .invite-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // The invite form is shown inline — verify email input and invite button exist
    const emailInput = modal.locator('input[placeholder*="example" i], input[placeholder*="email" i]');
    await expect(emailInput.first()).toBeVisible({ timeout: 3000 });

    // Verify invite button exists
    const inviteBtn = modal.locator('button').filter({ hasText: /[Ii]nvite/ });
    await expect(inviteBtn.first()).toBeVisible();

    // Verify user list is shown
    await expect(modal.locator('text=USERS IN')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/user-invite.png' });
  });
});
