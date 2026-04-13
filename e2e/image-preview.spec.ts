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

test.describe('Image Response Preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('image-preview-jpeg: JPEG response from picsum renders as an image', async ({ page }) => {
    const collectionName = uniqueName('Image JPEG Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://picsum.photos/200/300');
    await sendRequestAndWaitForResponse(page);

    const imagePreviewContainer = page.locator('[data-testid="image-preview-container"]');
    await expect(imagePreviewContainer).toBeVisible({ timeout: 20000 });

    const imagePreview = page.locator('[data-testid="image-preview"]');
    await expect(imagePreview).toBeVisible();

    const src = await imagePreview.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src!.toLowerCase()).toContain('image/jpeg');

    // Ensure the browser actually decoded the data URL and rendered bytes.
    // naturalWidth > 0 means the <img> successfully loaded the image.
    const naturalWidth = await imagePreview.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
    const onErrorFlag = await imagePreview.getAttribute('data-failed');
    expect(onErrorFlag).toBeNull();
  });

  test('image-preview-fallback-not-image: JSON response does not render image preview', async ({ page }) => {
    const collectionName = uniqueName('Image Fallback JSON Collection');
    await createTestRequest(page, collectionName);

    // Use a small reliable JSON endpoint.
    await page.locator('.url-input').fill('https://jsonplaceholder.typicode.com/posts/1');
    await sendRequestAndWaitForResponse(page);

    const imagePreviewContainer = page.locator('[data-testid="image-preview-container"]');
    await expect(imagePreviewContainer).not.toBeVisible({ timeout: 5000 });

    const jsonSurface = page.locator('.json-view-wrapper, .json-editor-wrapper, .cm-editor');
    await expect(jsonSurface.first()).toBeVisible({ timeout: 10000 });
  });
});
