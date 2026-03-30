import { test, expect } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

test.describe('Collections', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to finish loading - workspace selector shows actual name
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    // Wait for sidebar to be ready
    await expect(page.locator('.sidebar')).toBeVisible();
    // Wait for collection loading to complete (no loading spinner)
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('user can create a new collection', async ({ page }) => {
    // Click the + button in sidebar toolbar (last button) to create a collection
    // Wait for it to be enabled (title changes to "New Collection" when workspace is loaded)
    const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
    await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
    await addCollectionBtn.click();

    // Wait for prompt modal to appear
    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible({ timeout: 5000 });

    // Clear default value and enter new collection name
    const collectionName = uniqueName('Test Collection');
    const input = promptModal.locator('.prompt-input');
    await input.fill(collectionName);

    // Click OK to confirm
    await promptModal.locator('.prompt-btn-confirm').click();

    // Wait for modal to close
    await expect(promptModal).not.toBeVisible();

    // Verify the collection appears in the sidebar
    const collectionHeader = page.locator('.collection-header').filter({ hasText: collectionName });
    await expect(collectionHeader).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/collection-created.png' });
  });

  test('user can rename a collection', async ({ page }) => {
    // First create a collection to rename
    const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
    await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
    await addCollectionBtn.click();

    const originalName = uniqueName('Collection To Rename');
    const renamedName = uniqueName('Renamed Collection');

    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible();
    await promptModal.locator('.prompt-input').fill(originalName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Find the collection header and open context menu
    const collectionHeader = page.locator('.collection-header').filter({ hasText: originalName });
    await expect(collectionHeader).toBeVisible({ timeout: 5000 });

    // Hover to show the more button, then click it
    await collectionHeader.hover();
    const moreButton = collectionHeader.locator('.btn-menu');
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    // Click Rename in the context menu
    const contextMenu = page.locator('.collection-menu');
    await expect(contextMenu).toBeVisible();
    await contextMenu.locator('.request-menu-item').filter({ hasText: 'Rename' }).click();

    // Inline edit mode: collection name becomes an input field
    // The input appears in the sidebar - look for it globally (there should only be one)
    const renameInput = page.locator('.sidebar .rename-input');
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await renameInput.fill(renamedName);
    await renameInput.press('Enter');

    // Verify the collection was renamed
    await expect(page.locator('.collection-header').filter({ hasText: renamedName })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.collection-header').filter({ hasText: originalName })).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/collection-renamed.png' });
  });

  test('user can delete a collection', async ({ page }) => {
    // First create a collection to delete
    const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
    await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
    await addCollectionBtn.click();

    const collectionName = uniqueName('Collection To Delete');

    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible();
    await promptModal.locator('.prompt-input').fill(collectionName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Find the collection header
    const collectionHeader = page.locator('.collection-header').filter({ hasText: collectionName });
    await expect(collectionHeader).toBeVisible({ timeout: 5000 });

    // Hover to show the more button, then click it
    await collectionHeader.hover();
    const moreButton = collectionHeader.locator('.btn-menu');
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    // Click Delete in the context menu
    const contextMenu = page.locator('.collection-menu');
    await expect(contextMenu).toBeVisible();
    await contextMenu.locator('.request-menu-item.danger').filter({ hasText: 'Delete' }).click();

    // Confirm deletion in the confirm modal
    const confirmModal = page.locator('.confirm-modal');
    await expect(confirmModal).toBeVisible();
    await confirmModal.locator('.confirm-btn-confirm').click();

    // Verify the collection was deleted
    await expect(page.locator('.collection-header').filter({ hasText: collectionName })).not.toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/collection-deleted.png' });
  });
});
