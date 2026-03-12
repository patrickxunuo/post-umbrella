import { test, expect } from '@playwright/test';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

// Helper to create a collection and request for testing
async function createTestRequest(page, collectionName: string) {
  const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
  await addCollectionBtn.click();

  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible({ timeout: 5000 });
  await promptModal.locator('.prompt-input').fill(collectionName);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();

  const collectionHeader = page.locator('.collection-header').filter({ hasText: collectionName });
  await expect(collectionHeader).toBeVisible({ timeout: 5000 });
  await collectionHeader.hover();
  await collectionHeader.locator('.btn-menu').click();

  const collectionMenu = page.locator('.collection-menu');
  await expect(collectionMenu).toBeVisible();
  await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

  const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
  await expect(requestItem).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
}

// Helper to send a request and wait for response
async function sendRequestAndWaitForResponse(page) {
  const sendButton = page.locator('.btn-send');
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const responseViewer = page.locator('.response-viewer').first();
  await expect(responseViewer).toBeVisible({ timeout: 15000 });
  await expect(responseViewer.locator('.response-meta')).toBeVisible({ timeout: 15000 });
}

// Helper to save current request/response as an example
async function saveAsExample(page, exampleName: string) {
  await page.locator('.btn-save-dropdown').click();
  const saveDropdownMenu = page.locator('.save-dropdown-menu');
  await expect(saveDropdownMenu).toBeVisible();
  await saveDropdownMenu.locator('.save-dropdown-item').filter({ hasText: 'Save as Example' }).click();

  const exampleModal = page.locator('.save-example-modal');
  await expect(exampleModal).toBeVisible({ timeout: 5000 });
  await exampleModal.locator('.example-name-input').fill(exampleName);
  await exampleModal.locator('.btn-confirm').click();
  await expect(exampleModal).not.toBeVisible({ timeout: 5000 });
}

test.describe('Examples', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('user can save request as example', async ({ page }) => {
    const collectionName = uniqueName('Example Save Collection');
    const exampleName = uniqueName('My Example');

    await createTestRequest(page, collectionName);

    // Set a URL
    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/get');

    // Save the request first (required - request needs a database ID)
    const saveBtn = page.locator('.btn-save');
    await saveBtn.click();
    await expect(saveBtn).not.toContainText('*', { timeout: 5000 });

    // Send request to get a response
    await sendRequestAndWaitForResponse(page);

    // Save as example
    await saveAsExample(page, exampleName);

    // Verify: an example tab should open with the example name
    const exampleTab = page.locator('.open-tab').filter({ hasText: exampleName });
    await expect(exampleTab).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: 'e2e/screenshots/example-saved.png' });
  });

  test('user can view a saved example', async ({ page }) => {
    const collectionName = uniqueName('Example View Collection');
    const exampleName = uniqueName('View Example');

    await createTestRequest(page, collectionName);

    // Set URL and save the request first
    await page.locator('.url-input').fill('https://httpbin.org/get');
    const saveBtn = page.locator('.btn-save');
    await saveBtn.click();
    await expect(saveBtn).not.toContainText('*', { timeout: 5000 });

    // Send request and save as example
    await sendRequestAndWaitForResponse(page);
    await saveAsExample(page, exampleName);

    // Example tab should open automatically
    const exampleTab = page.locator('.open-tab').filter({ hasText: exampleName });
    await expect(exampleTab).toBeVisible({ timeout: 10000 });

    // Click the example tab to activate it
    await exampleTab.click();

    // The request editor should show the URL from the example
    await expect(page.locator('.url-input')).toHaveValue('https://httpbin.org/get');

    // The method should be visible
    const methodSelector = page.locator('.method-selector-trigger');
    await expect(methodSelector).toContainText('GET');

    await page.screenshot({ path: 'e2e/screenshots/example-viewed.png' });
  });

  test('user can delete an example', async ({ page }) => {
    const collectionName = uniqueName('Example Delete Collection');
    const exampleName = uniqueName('Delete Example');

    await createTestRequest(page, collectionName);

    // Set URL, send request, and save as example
    await page.locator('.url-input').fill('https://httpbin.org/get');
    await sendRequestAndWaitForResponse(page);

    // First save the request itself so the request has an ID
    const saveBtn = page.locator('.btn-save');
    await saveBtn.click();
    await expect(saveBtn).not.toContainText('*', { timeout: 5000 });

    // Now save as example
    await saveAsExample(page, exampleName);

    // Wait a moment for the example to be saved to the database
    await page.waitForTimeout(1000);

    // The request should now show an expand icon in the sidebar
    // Click the expand icon to show the examples list
    const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
    const expandIcon = requestItem.locator('.request-expand');

    // Wait for the expand icon to appear (example_count updated)
    await expect(expandIcon).toBeVisible({ timeout: 10000 });
    await expandIcon.click();

    // Wait for examples to load
    const examplesList = page.locator('.examples-list-sidebar');
    await expect(examplesList).toBeVisible({ timeout: 10000 });

    // Find the example and delete it
    const exampleItem = examplesList.locator('.example-item-sidebar').filter({ hasText: exampleName });
    await expect(exampleItem).toBeVisible({ timeout: 5000 });
    await exampleItem.hover();

    // Click the menu button
    await exampleItem.locator('.btn-menu').click();

    // Click Delete in the context menu
    const exampleMenu = page.locator('.example-menu');
    await expect(exampleMenu).toBeVisible({ timeout: 3000 });
    await exampleMenu.locator('button').filter({ hasText: 'Delete' }).click();

    // Confirm deletion
    const confirmModal = page.locator('.confirm-modal');
    await expect(confirmModal).toBeVisible({ timeout: 3000 });
    await confirmModal.locator('.confirm-btn-confirm').click();
    await expect(confirmModal).not.toBeVisible({ timeout: 3000 });

    // Example should no longer be visible
    await expect(exampleItem).not.toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/example-deleted.png' });
  });
});
