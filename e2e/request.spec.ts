import { test, expect } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

test.describe('Requests', () => {
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

  test('user can create a new request in a collection', async ({ page }) => {
    // First create a collection to hold the request
    const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
    await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
    await addCollectionBtn.click();

    const collectionName = uniqueName('Request Test Collection');
    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible({ timeout: 5000 });
    await promptModal.locator('.prompt-input').fill(collectionName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Find the collection header
    const collectionHeader = page.locator('.collection-header').filter({ hasText: collectionName });
    await expect(collectionHeader).toBeVisible({ timeout: 5000 });

    // Hover and click the more button
    await collectionHeader.hover();
    const moreButton = collectionHeader.locator('.btn-menu');
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    // Click "Add Request" in the context menu
    const contextMenu = page.locator('.collection-menu');
    await expect(contextMenu).toBeVisible();
    await contextMenu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

    // Wait for the collection to expand and show the new request
    // The default name is "New Request"
    const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
    await expect(requestItem).toBeVisible({ timeout: 5000 });

    // The request should also be opened in a tab - verify the editor shows
    const requestEditor = page.locator('.request-editor, .request-panel, .tab-panel');
    await expect(requestEditor.first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/request-created.png' });
  });

  test('user can delete a request', async ({ page }) => {
    // First create a collection and a request
    const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
    await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
    await addCollectionBtn.click();

    const collectionName = uniqueName('Delete Request Collection');
    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible({ timeout: 5000 });
    await promptModal.locator('.prompt-input').fill(collectionName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Find collection and add a request
    const collectionHeader = page.locator('.collection-header').filter({ hasText: collectionName });
    await expect(collectionHeader).toBeVisible({ timeout: 5000 });
    await collectionHeader.hover();
    await collectionHeader.locator('.btn-menu').click();

    const collectionMenu = page.locator('.collection-menu');
    await expect(collectionMenu).toBeVisible();
    await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

    // Wait for request to appear
    const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
    await expect(requestItem).toBeVisible({ timeout: 5000 });

    // Hover on request and click more button
    await requestItem.hover();
    const requestMoreBtn = requestItem.locator('.btn-menu');
    await expect(requestMoreBtn).toBeVisible();
    await requestMoreBtn.click();

    // Click Delete in the request menu
    const requestMenu = page.locator('.request-menu').filter({ has: page.locator('button').filter({ hasText: 'Delete' }) });
    await expect(requestMenu).toBeVisible();
    await requestMenu.locator('.request-menu-item.danger').filter({ hasText: 'Delete' }).click();

    // Confirm deletion
    const confirmModal = page.locator('.confirm-modal');
    await expect(confirmModal).toBeVisible();
    await confirmModal.locator('.confirm-btn-confirm').click();

    // Verify request was deleted - should not be visible anymore
    await expect(page.locator('.request-item').filter({ hasText: 'New Request' })).not.toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/request-deleted.png' });
  });
});
