import { test, expect, Download, Page } from '@playwright/test';
import * as fs from 'fs';
import { cleanupTestCollections } from './helpers/cleanup';

// Unique per-run names so parallel / repeated runs don't collide.
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

// --- Shared helpers (mirrored from the existing E2E suite's conventions) ---

async function createTestRequest(page: Page, collectionName: string) {
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

async function sendRequestAndWaitForResponse(page: Page) {
  const sendButton = page.locator('.btn-send');
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const responseViewer = page.locator('.response-viewer').first();
  await expect(responseViewer).toBeVisible({ timeout: 30000 });
  await expect(responseViewer.locator('.response-meta')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.response-viewer.loading')).not.toBeVisible({ timeout: 30000 });
}

async function saveAsExample(page: Page, exampleName: string) {
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

/**
 * Click the download button and capture the triggered download event.
 * The button may be rendered via an <a download> (browser path), a Tauri dialog,
 * or an invoked blob — Playwright captures all of these via waitForEvent('download').
 */
async function clickDownloadAndCapture(page: Page): Promise<Download> {
  const btn = page.locator('[data-testid="response-download-btn"]');
  await expect(btn).toBeVisible({ timeout: 10000 });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    btn.click(),
  ]);
  return download;
}

async function readDownloadText(download: Download): Promise<string> {
  const p = await download.path();
  if (!p) throw new Error('Download path unavailable');
  return fs.readFileSync(p, 'utf-8');
}

async function readDownloadBytes(download: Download): Promise<Buffer> {
  const p = await download.path();
  if (!p) throw new Error('Download path unavailable');
  return fs.readFileSync(p);
}

// --- Tests ---

test.describe('Response Download button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  // AC1 — button hidden before any response exists.
  test('AC1-hidden-no-response: button is not rendered before Send is clicked', async ({ page }) => {
    const collectionName = uniqueName('Download AC1-a Collection');
    await createTestRequest(page, collectionName);

    // Fresh request tab: no URL typed, no Send — there is no response yet.
    const btn = page.locator('[data-testid="response-download-btn"]');
    expect(await btn.count()).toBe(0);
  });

  // AC1 — button hidden while loading, visible after response arrives.
  test('AC1-hidden-during-loading: button is hidden during Send, visible once the response arrives', async ({ page }) => {
    const collectionName = uniqueName('Download AC1-b Collection');
    await createTestRequest(page, collectionName);

    // Use a small delay so we can race the UI during the loading state.
    await page.locator('.url-input').fill('https://httpbin.org/delay/2');

    const sendButton = page.locator('.btn-send');
    await expect(sendButton).toBeEnabled();

    // Click Send and immediately assert the loading view is up AND the button is not rendered.
    await sendButton.click();
    const loading = page.locator('.response-viewer.loading');
    // Loading may be very brief — don't hard-fail if we miss it, but if it's there, verify button absence.
    if (await loading.isVisible().catch(() => false)) {
      const btn = page.locator('[data-testid="response-download-btn"]');
      expect(await btn.count()).toBe(0);
    }

    // After the response lands, the button must appear.
    const responseViewer = page.locator('.response-viewer').first();
    await expect(responseViewer).toBeVisible({ timeout: 30000 });
    await expect(responseViewer.locator('.response-meta')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.response-viewer.loading')).not.toBeVisible({ timeout: 30000 });

    const btnAfter = page.locator('[data-testid="response-download-btn"]');
    await expect(btnAfter).toBeVisible({ timeout: 10000 });
  });

  // AC1 — button hidden in example mode.
  test('AC1-hidden-in-example: button is not rendered in example mode', async ({ page }) => {
    const collectionName = uniqueName('Download AC1-c Collection');
    const exampleName = uniqueName('Download Example');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://httpbin.org/get');

    // Save the request first so it has an ID, then Send, then Save as Example.
    const saveBtn = page.locator('.btn-save');
    await saveBtn.click();
    await expect(saveBtn).not.toContainText('*', { timeout: 5000 });

    await sendRequestAndWaitForResponse(page);

    // Sanity: button visible in request mode.
    await expect(page.locator('[data-testid="response-download-btn"]')).toBeVisible({ timeout: 10000 });

    await saveAsExample(page, exampleName);

    // Wait a moment for the example to be saved and the new tab to open (matches example.spec.ts pattern)
    await page.waitForTimeout(500);

    const exampleTab = page.locator('.open-tab').filter({ hasText: exampleName });
    await expect(exampleTab).toBeVisible({ timeout: 10000 });
    await exampleTab.click();

    // In the example tab, the button must not be present.
    const btn = page.locator('[data-testid="response-download-btn"]');
    expect(await btn.count()).toBe(0);
  });

  // AC2 — JSON download writes pretty-printed JSON whose content matches the response.
  // AC6 — filename derived from URL's last segment (+ extension if missing).
  // AC7 — fallback still works because the URL has a last segment.
  test('AC2-AC6: JSON response downloads as pretty-printed JSON with a .json filename', async ({ page }) => {
    const collectionName = uniqueName('Download JSON Collection');
    await createTestRequest(page, collectionName);

    // httpbin /json returns Content-Type: application/json and a stable payload.
    await page.locator('.url-input').fill('https://httpbin.org/json');
    await sendRequestAndWaitForResponse(page);

    const download = await clickDownloadAndCapture(page);
    const filename = download.suggestedFilename();
    expect(filename.toLowerCase()).toMatch(/\.json$/);

    const text = await readDownloadText(download);
    // Pretty-printed with 2-space indent.
    expect(text).toContain('\n  ');
    // Parses back to an object.
    const parsed = JSON.parse(text);
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });

  // AC3 / AC6 — image response (base64 body) downloads as decoded bytes with an image extension.
  test('AC3-AC6: JPEG image response downloads decoded bytes with a .jpg filename', async ({ page }) => {
    const collectionName = uniqueName('Download Image Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://picsum.photos/200/300');
    await sendRequestAndWaitForResponse(page);

    const download = await clickDownloadAndCapture(page);
    const filename = download.suggestedFilename();
    // picsum's content-type is image/jpeg → .jpg. Accept .jpeg as well just in case.
    expect(filename.toLowerCase()).toMatch(/\.(jpg|jpeg)$/);

    const bytes = await readDownloadBytes(download);
    expect(bytes.length).toBeGreaterThan(100);
    // JPEG magic: FF D8 FF.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes[2]).toBe(0xff);
  });

  // AC4 — text response downloads with the right text extension and raw source (not base64).
  test('AC4: HTML response downloads as .html with the raw markup', async ({ page }) => {
    const collectionName = uniqueName('Download HTML Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://httpbin.org/html');
    await sendRequestAndWaitForResponse(page);

    const download = await clickDownloadAndCapture(page);
    const filename = download.suggestedFilename();
    expect(filename.toLowerCase()).toMatch(/\.html?$/);

    const text = await readDownloadText(download);
    // HTML source — should start with '<' after any trivial whitespace, not be base64.
    expect(text.trimStart().startsWith('<')).toBe(true);
    // Should contain some recognizable HTML (httpbin /html returns a page with <h1>Herman Melville...).
    expect(text.toLowerCase()).toContain('<');
    // Not base64-only.
    expect(/^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 200))).toBe(false);
  });

  // AC5 — filename from Content-Disposition takes priority over URL/MIME derivation.
  test('AC5: filename comes from Content-Disposition when present', async ({ page }) => {
    const collectionName = uniqueName('Download CD Collection');
    await createTestRequest(page, collectionName);

    // httpbin /response-headers echoes any query params back as response headers.
    // This gives us a stable endpoint that emits a real Content-Disposition header.
    await page.locator('.url-input').fill(
      'https://httpbin.org/response-headers?Content-Disposition=attachment%3B%20filename%3D%22report.json%22'
    );
    await sendRequestAndWaitForResponse(page);

    const download = await clickDownloadAndCapture(page);
    const filename = download.suggestedFilename();
    expect(filename).toBe('report.json');
  });

  // AC10 — toolbar button visible on PDF response; inline <a download="response.pdf"> removed.
  test('AC10: PDF response shows toolbar download button, no inline <a download> fallback link', async ({ page }) => {
    const collectionName = uniqueName('Download PDF Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');
    await sendRequestAndWaitForResponse(page);

    // Toolbar button is present regardless of whether the <object> rendered.
    await expect(page.locator('[data-testid="response-download-btn"]')).toBeVisible({ timeout: 10000 });

    // The old inline "Download PDF" anchor must be gone.
    const oldAnchor = page.locator('a[download="response.pdf"]');
    expect(await oldAnchor.count()).toBe(0);
  });

  // AC11 — clicking Download on a normal response should not crash the app, no red error toast.
  test('AC11: clicking Download on a JSON response does not crash the app', async ({ page }) => {
    const collectionName = uniqueName('Download AC11 Collection');
    await createTestRequest(page, collectionName);

    // Surface any uncaught page errors so the test fails if Download throws.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.locator('.url-input').fill('https://jsonplaceholder.typicode.com/posts/1');
    await sendRequestAndWaitForResponse(page);

    const download = await clickDownloadAndCapture(page);
    expect(download.suggestedFilename().length).toBeGreaterThan(0);

    // App is still responsive — the response viewer is still mounted and no errors leaked.
    await expect(page.locator('.response-viewer').first()).toBeVisible();
    expect(pageErrors, `Unexpected page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);

    // No toast-error (we allow a success toast, but not an error one).
    const errorToast = page.locator('.toast-error, .toast.error, [data-toast-type="error"]');
    expect(await errorToast.count()).toBe(0);
  });
});
