import { test, expect } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

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

async function sendRequestAndWaitForResponse(page) {
  const sendButton = page.locator('.btn-send');
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const responseViewer = page.locator('.response-viewer').first();
  await expect(responseViewer).toBeVisible({ timeout: 30000 });
  await expect(responseViewer.locator('.response-meta')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.response-viewer.loading')).not.toBeVisible({ timeout: 30000 });
}

test.describe('Binary view toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('image-toggle-raw: clicking Raw shows raw body and hides image preview', async ({ page }) => {
    const collectionName = uniqueName('Image Toggle Raw Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://picsum.photos/200/300');
    await sendRequestAndWaitForResponse(page);

    const imagePreview = page.locator('[data-testid="image-preview"]');
    await expect(imagePreview).toBeVisible({ timeout: 20000 });

    await page.locator('[data-testid="image-raw-btn"]').click();

    const rawBody = page.locator('[data-testid="image-raw-body"]');
    await expect(rawBody).toBeVisible({ timeout: 10000 });

    const rawText = await rawBody.textContent();
    expect(rawText).toBeTruthy();
    expect(rawText!.trim().length).toBeGreaterThan(0);

    await expect(imagePreview).not.toBeVisible();
  });

  test('image-toggle-hex: clicking Hex shows hex dump with address/byte format', async ({ page }) => {
    const collectionName = uniqueName('Image Toggle Hex Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://picsum.photos/200/300');
    await sendRequestAndWaitForResponse(page);

    const imagePreview = page.locator('[data-testid="image-preview"]');
    await expect(imagePreview).toBeVisible({ timeout: 20000 });

    await page.locator('[data-testid="image-hex-btn"]').click();

    const hexBody = page.locator('[data-testid="image-hex-body"]');
    await expect(hexBody).toBeVisible({ timeout: 10000 });

    const hexText = await hexBody.textContent();
    expect(hexText).toBeTruthy();
    const firstLine = hexText!.split('\n')[0];
    expect(firstLine).toMatch(/^[0-9a-f]{8}\s+[0-9a-f]{2}/i);
  });

  test('image-toggle-back-to-preview: from hex view, clicking Preview restores image', async ({ page }) => {
    const collectionName = uniqueName('Image Toggle Back Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://picsum.photos/200/300');
    await sendRequestAndWaitForResponse(page);

    const imagePreview = page.locator('[data-testid="image-preview"]');
    await expect(imagePreview).toBeVisible({ timeout: 20000 });

    // Switch to hex view first
    await page.locator('[data-testid="image-hex-btn"]').click();
    await expect(page.locator('[data-testid="image-hex-body"]')).toBeVisible({ timeout: 10000 });
    await expect(imagePreview).not.toBeVisible();

    // Now switch back to preview
    await page.locator('[data-testid="image-preview-btn"]').click();

    await expect(imagePreview).toBeVisible({ timeout: 10000 });
    const src = await imagePreview.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src!.length).toBeGreaterThan(0);
  });

  test('pdf-toggle-raw: clicking Raw on PDF response shows raw body text', async ({ page }) => {
    const collectionName = uniqueName('PDF Toggle Raw Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');
    await sendRequestAndWaitForResponse(page);

    // Wait for PDF branch to render the toggle
    await expect(page.locator('[data-testid="pdf-view-toggle"]')).toBeVisible({ timeout: 20000 });

    await page.locator('[data-testid="pdf-raw-btn"]').click();

    const rawBody = page.locator('[data-testid="pdf-raw-body"]');
    await expect(rawBody).toBeVisible({ timeout: 10000 });

    const rawText = await rawBody.textContent();
    expect(rawText).toBeTruthy();
    expect(rawText!.trim().length).toBeGreaterThan(0);
  });

  test('pdf-toggle-hex: clicking Hex on PDF shows hex dump starting with %PDF magic bytes', async ({ page }) => {
    const collectionName = uniqueName('PDF Toggle Hex Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');
    await sendRequestAndWaitForResponse(page);

    // Wait for PDF branch to render the toggle
    await expect(page.locator('[data-testid="pdf-view-toggle"]')).toBeVisible({ timeout: 20000 });

    await page.locator('[data-testid="pdf-hex-btn"]').click();

    const hexBody = page.locator('[data-testid="pdf-hex-body"]');
    await expect(hexBody).toBeVisible({ timeout: 10000 });

    const hexText = await hexBody.textContent();
    expect(hexText).toBeTruthy();
    const firstLine = hexText!.split('\n')[0];
    // General hex row format
    expect(firstLine).toMatch(/^[0-9a-f]{8}\s+[0-9a-f]{2}/i);
    // PDFs always start with 25 50 44 46 ("%PDF")
    expect(firstLine.startsWith('00000000  25 50 44 46')).toBe(true);
  });
});
