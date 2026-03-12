import { test, expect } from '@playwright/test';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

// Helper to create a collection and request for testing
async function createTestRequest(page, collectionName: string) {
  // Create a collection
  const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
  await addCollectionBtn.click();

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

  // Wait for request to appear and be selected
  const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
  await expect(requestItem).toBeVisible({ timeout: 5000 });

  // Wait for request editor to load
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
}

test.describe('Request Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to finish loading
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('user can edit request method, URL, and headers', async ({ page }) => {
    const collectionName = uniqueName('Edit Test Collection');
    await createTestRequest(page, collectionName);

    // Change HTTP method from GET to POST
    const methodSelector = page.locator('.method-selector-trigger');
    await expect(methodSelector).toBeVisible();
    await methodSelector.click();

    const methodDropdown = page.locator('.method-selector-dropdown');
    await expect(methodDropdown).toBeVisible();
    await methodDropdown.locator('.method-selector-option').filter({ hasText: 'POST' }).click();

    // Verify method changed
    await expect(methodSelector).toContainText('POST');

    // Edit URL
    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/post');
    await expect(urlInput).toHaveValue('https://httpbin.org/post');

    // Click Headers tab
    await page.locator('.request-tabs button').filter({ hasText: 'Headers' }).click();

    // Add a header
    const headersEditor = page.locator('.headers-editor');
    await expect(headersEditor).toBeVisible();

    // Find the first empty header row and fill it
    const headerKeyInput = headersEditor.locator('tbody tr').first().locator('input[placeholder="Header name"]');
    const headerValueInput = headersEditor.locator('tbody tr').first().locator('input[placeholder="Value"]');

    await headerKeyInput.fill('X-Custom-Header');
    await headerValueInput.fill('test-value');

    // Click Body tab and set JSON body
    await page.locator('.request-tabs button').filter({ hasText: 'Body' }).click();

    // Select JSON body type
    const bodyEditor = page.locator('.body-editor');
    await expect(bodyEditor).toBeVisible();
    await bodyEditor.locator('label').filter({ hasText: 'JSON' }).click();

    // The JSON editor (CodeMirror) should appear
    const jsonEditor = page.locator('.json-editor-wrapper');
    await expect(jsonEditor).toBeVisible({ timeout: 5000 });

    // Save the request
    const saveButton = page.locator('.btn-save');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Wait for save to complete (dirty indicator should disappear)
    await expect(saveButton).not.toContainText('*', { timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/request-edited.png' });
  });

  test('user can send a request and view response', async ({ page }) => {
    const collectionName = uniqueName('Send Test Collection');
    await createTestRequest(page, collectionName);

    // Set URL to a public API endpoint
    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/get');

    // Click Send button
    const sendButton = page.locator('.btn-send');
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // Wait for response viewer to appear (indicates request was attempted)
    const responseViewer = page.locator('.response-viewer').first();
    await expect(responseViewer).toBeVisible({ timeout: 15000 });

    // The response meta should be visible (shows status and time)
    const responseMeta = responseViewer.locator('.response-meta');
    await expect(responseMeta).toBeVisible({ timeout: 15000 });

    // Should show some status (could be success or error, but should show something)
    const statusElement = responseMeta.locator('.status');
    await expect(statusElement).toBeVisible();

    // Should not be in loading state anymore
    await expect(page.locator('.response-viewer.loading')).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/request-sent.png' });
  });
});
