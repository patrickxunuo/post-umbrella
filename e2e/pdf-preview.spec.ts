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

test.describe('PDF Response Preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('pdf-preview-renders: application/pdf response renders inline in an <object>', async ({ page }) => {
    const collectionName = uniqueName('PDF Preview Collection');
    await createTestRequest(page, collectionName);

    // Stable, small W3C-hosted dummy PDF (~13KB).
    await page.locator('.url-input').fill('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');
    await sendRequestAndWaitForResponse(page);

    const pdfContainer = page.locator('[data-testid="pdf-preview-container"]');
    await expect(pdfContainer).toBeVisible({ timeout: 20000 });

    const pdfFrame = page.locator('[data-testid="pdf-preview-frame"]');
    await expect(pdfFrame).toBeVisible();

    // The <object> data attribute should be a base64 data URL with the PDF mime type.
    // We cannot introspect what the browser's built-in PDF viewer renders inside the <object>.
    const dataAttr = await pdfFrame.getAttribute('data');
    expect(dataAttr).toBeTruthy();
    expect(dataAttr!).toMatch(/^data:application\/pdf;base64,/);
  });

  test('pdf-preview-fallback-not-pdf: JSON response does not render PDF preview', async ({ page }) => {
    const collectionName = uniqueName('PDF Fallback JSON Collection');
    await createTestRequest(page, collectionName);

    // Small reliable JSON endpoint — should not trigger the PDF branch.
    await page.locator('.url-input').fill('https://jsonplaceholder.typicode.com/posts/1');
    await sendRequestAndWaitForResponse(page);

    const pdfContainer = page.locator('[data-testid="pdf-preview-container"]');
    await expect(pdfContainer).not.toBeVisible({ timeout: 5000 });

    const jsonSurface = page.locator('.json-view-wrapper, .json-editor-wrapper, .cm-editor');
    await expect(jsonSurface.first()).toBeVisible({ timeout: 10000 });
  });
});
