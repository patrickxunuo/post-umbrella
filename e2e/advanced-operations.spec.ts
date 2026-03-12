import { test, expect } from '@playwright/test';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.describe('Advanced Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to finish loading
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('user can move a request to a different collection', async ({ page }) => {
    // Create two collections
    const sourceCollectionName = uniqueName('Source Collection');
    const targetCollectionName = uniqueName('Target Collection');

    // Create source collection
    const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
    await addCollectionBtn.click();
    let promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible();
    await promptModal.locator('.prompt-input').fill(sourceCollectionName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Create target collection
    await addCollectionBtn.click();
    promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible();
    await promptModal.locator('.prompt-input').fill(targetCollectionName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Add a request to source collection
    const sourceCollectionHeader = page.locator('.collection-header').filter({ hasText: sourceCollectionName });
    await expect(sourceCollectionHeader).toBeVisible({ timeout: 5000 });
    await sourceCollectionHeader.hover();
    await sourceCollectionHeader.locator('.btn-menu').click();

    let collectionMenu = page.locator('.collection-menu');
    await expect(collectionMenu).toBeVisible();
    await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

    // Wait for request to appear in source collection
    const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
    await expect(requestItem).toBeVisible({ timeout: 5000 });

    // Open request context menu and click "Move to..."
    await requestItem.hover();
    const requestMoreBtn = requestItem.locator('.btn-menu');
    await expect(requestMoreBtn).toBeVisible();
    await requestMoreBtn.click();

    const requestMenu = page.locator('.request-menu').filter({ has: page.locator('button').filter({ hasText: 'Move to' }) });
    await expect(requestMenu).toBeVisible();
    await requestMenu.locator('.request-menu-item').filter({ hasText: 'Move to' }).click();

    // Move modal should appear
    const moveModal = page.locator('.move-to-modal');
    await expect(moveModal).toBeVisible({ timeout: 5000 });

    // Select target collection
    const targetFolder = moveModal.locator('.move-to-folder-item').filter({ hasText: targetCollectionName });
    await expect(targetFolder).toBeVisible();
    await targetFolder.click();

    // Click Move button
    await moveModal.locator('.btn-primary').filter({ hasText: 'Move' }).click();

    // Modal should close
    await expect(moveModal).not.toBeVisible({ timeout: 5000 });

    // Expand target collection to see the moved request
    const targetCollectionHeader = page.locator('.collection-header').filter({ hasText: targetCollectionName });
    await targetCollectionHeader.click();

    // Verify request is now in target collection
    // The request should be visible under the target collection
    await expect(page.locator('.collection').filter({ has: targetCollectionHeader }).locator('.request-item').filter({ hasText: 'New Request' })).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/request-moved.png' });
  });

  test('user can create nested sub-collections', async ({ page }) => {
    const parentCollectionName = uniqueName('Parent Collection');
    const childCollectionName = uniqueName('Child Folder');

    // Create parent collection
    const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
    await addCollectionBtn.click();
    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible();
    await promptModal.locator('.prompt-input').fill(parentCollectionName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Find parent collection and open context menu
    const parentCollectionHeader = page.locator('.collection-header').filter({ hasText: parentCollectionName });
    await expect(parentCollectionHeader).toBeVisible({ timeout: 5000 });
    await parentCollectionHeader.hover();
    await parentCollectionHeader.locator('.btn-menu').click();

    // Click "Add Folder" to create a sub-collection
    const collectionMenu = page.locator('.collection-menu');
    await expect(collectionMenu).toBeVisible();
    await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Folder' }).click();

    // Enter name for sub-collection
    const folderPrompt = page.locator('.prompt-modal');
    await expect(folderPrompt).toBeVisible({ timeout: 5000 });
    await folderPrompt.locator('.prompt-input').fill(childCollectionName);
    await folderPrompt.locator('.prompt-btn-confirm').click();
    await expect(folderPrompt).not.toBeVisible();

    // Parent collection should now be expanded showing the child folder
    // The child folder should have a folder icon and be indented
    const childCollectionHeader = page.locator('.collection-header').filter({ hasText: childCollectionName });
    await expect(childCollectionHeader).toBeVisible({ timeout: 5000 });

    // Verify child has the folder icon (indicating it's a sub-folder)
    await expect(childCollectionHeader.locator('.folder-icon')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/collection-nested.png' });
  });
});
