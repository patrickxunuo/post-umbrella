import { test, expect } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

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

test.describe('HTML Preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('FE-001: HTML response shows rendered preview in iframe with Preview button active', async ({ page }) => {
    const collectionName = uniqueName('HTML Preview Collection');
    await createTestRequest(page, collectionName);

    // Use a URL that returns text/html content (e.g., httpbin returns HTML for /html)
    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/html');

    await sendRequestAndWaitForResponse(page);

    // The toggle container should be visible for HTML responses
    const toggleContainer = page.locator('[data-testid="html-view-toggle"]');
    await expect(toggleContainer).toBeVisible({ timeout: 10000 });

    // Preview button should be visible and active (default mode)
    const previewBtn = page.locator('[data-testid="html-preview-btn"]');
    await expect(previewBtn).toBeVisible();
    await expect(previewBtn).toHaveClass(/active/);

    // The iframe should be visible with the HTML content
    const iframe = page.locator('[data-testid="html-preview-frame"]');
    await expect(iframe).toBeVisible();

    // The iframe should have sandbox="" for security
    await expect(iframe).toHaveAttribute('sandbox', '');

    // Raw body should NOT be visible in preview mode
    const rawBody = page.locator('[data-testid="html-raw-body"]');
    await expect(rawBody).not.toBeVisible();
  });

  test('FE-002: clicking Raw button hides iframe and shows raw HTML source', async ({ page }) => {
    const collectionName = uniqueName('HTML Raw Collection');
    await createTestRequest(page, collectionName);

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/html');

    await sendRequestAndWaitForResponse(page);

    // Wait for toggle to appear
    const toggleContainer = page.locator('[data-testid="html-view-toggle"]');
    await expect(toggleContainer).toBeVisible({ timeout: 10000 });

    // Click the Raw button
    const rawBtn = page.locator('[data-testid="html-raw-btn"]');
    await expect(rawBtn).toBeVisible();
    await rawBtn.click();

    // Raw button should now be active
    await expect(rawBtn).toHaveClass(/active/);

    // Preview button should no longer be active
    const previewBtn = page.locator('[data-testid="html-preview-btn"]');
    await expect(previewBtn).not.toHaveClass(/active/);

    // Iframe should be hidden
    const iframe = page.locator('[data-testid="html-preview-frame"]');
    await expect(iframe).not.toBeVisible();

    // Raw HTML source should be visible in a pre element
    const rawBody = page.locator('[data-testid="html-raw-body"]');
    await expect(rawBody).toBeVisible();

    // Raw body should contain HTML markup
    await expect(rawBody).toContainText('<');
  });

  test('FE-003: clicking Preview after Raw re-shows iframe and hides raw', async ({ page }) => {
    const collectionName = uniqueName('HTML Toggle Collection');
    await createTestRequest(page, collectionName);

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/html');

    await sendRequestAndWaitForResponse(page);

    const toggleContainer = page.locator('[data-testid="html-view-toggle"]');
    await expect(toggleContainer).toBeVisible({ timeout: 10000 });

    // Switch to Raw first
    const rawBtn = page.locator('[data-testid="html-raw-btn"]');
    await rawBtn.click();
    await expect(rawBtn).toHaveClass(/active/);

    // Now switch back to Preview
    const previewBtn = page.locator('[data-testid="html-preview-btn"]');
    await previewBtn.click();

    // Preview button should be active again
    await expect(previewBtn).toHaveClass(/active/);

    // Raw button should no longer be active
    await expect(rawBtn).not.toHaveClass(/active/);

    // Iframe should re-appear
    const iframe = page.locator('[data-testid="html-preview-frame"]');
    await expect(iframe).toBeVisible();

    // Raw body should be hidden
    const rawBody = page.locator('[data-testid="html-raw-body"]');
    await expect(rawBody).not.toBeVisible();
  });

  test('FE-004: JSON response shows JSON tree view with no HTML toggle', async ({ page }) => {
    const collectionName = uniqueName('JSON No Toggle Collection');
    await createTestRequest(page, collectionName);

    // Use a URL that returns application/json
    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/get');

    await sendRequestAndWaitForResponse(page);

    // The HTML toggle should NOT be visible for JSON responses
    const toggleContainer = page.locator('[data-testid="html-view-toggle"]');
    await expect(toggleContainer).not.toBeVisible({ timeout: 5000 });

    // No iframe should be present
    const iframe = page.locator('[data-testid="html-preview-frame"]');
    await expect(iframe).not.toBeVisible();

    // The response viewer should show JSON tree view (existing component)
    const responseViewer = page.locator('.response-viewer').first();
    await expect(responseViewer).toBeVisible();
  });

  test('FE-005: HTML Content-Type with valid JSON body shows JSON tree, no HTML toggle', async ({ page }) => {
    const collectionName = uniqueName('HTML JSON Priority Collection');
    await createTestRequest(page, collectionName);

    // Change method to POST to use httpbin /response-headers which lets us set custom headers
    // Use httpbin /response-headers to get a response with text/html content-type but JSON body
    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/response-headers?Content-Type=text/html&freeform={"key":"value"}');

    await sendRequestAndWaitForResponse(page);

    // JSON should take priority: the HTML toggle should NOT be visible
    const toggleContainer = page.locator('[data-testid="html-view-toggle"]');
    await expect(toggleContainer).not.toBeVisible({ timeout: 5000 });

    // No iframe should be present
    const iframe = page.locator('[data-testid="html-preview-frame"]');
    await expect(iframe).not.toBeVisible();
  });

  test('FE-006: example mode with HTML body shows JsonEditor, no iframe preview', async ({ page }) => {
    const collectionName = uniqueName('HTML Example Collection');
    const exampleName = uniqueName('HTML Example');
    await createTestRequest(page, collectionName);

    // Set URL to return HTML
    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/html');

    // Save the request first (required for saving examples)
    const saveBtn = page.locator('.btn-save');
    await saveBtn.click();
    await expect(saveBtn).not.toContainText('*', { timeout: 5000 });

    // Send request to get a response
    await sendRequestAndWaitForResponse(page);

    // Verify HTML preview is shown in request mode (sanity check)
    const toggleContainer = page.locator('[data-testid="html-view-toggle"]');
    await expect(toggleContainer).toBeVisible({ timeout: 10000 });

    // Save as example
    await saveAsExample(page, exampleName);

    // Example tab should open automatically
    const exampleTab = page.locator('.open-tab').filter({ hasText: exampleName });
    await expect(exampleTab).toBeVisible({ timeout: 10000 });

    // Click the example tab to activate it
    await exampleTab.click();

    // In example mode, there should be no HTML toggle or iframe
    const exampleToggle = page.locator('[data-testid="html-view-toggle"]');
    await expect(exampleToggle).not.toBeVisible({ timeout: 5000 });

    const exampleIframe = page.locator('[data-testid="html-preview-frame"]');
    await expect(exampleIframe).not.toBeVisible();

    // JsonEditor should be used instead (CodeMirror editor for response body)
    const jsonEditor = page.locator('.json-editor-wrapper, .cm-editor');
    await expect(jsonEditor.first()).toBeVisible({ timeout: 5000 });
  });
});
