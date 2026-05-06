/**
 * Marketing screenshot capture spec.
 *
 * Seeds a clean "Pet Store API" demo (collection + 5 requests + environment),
 * then captures README screenshots into docs/screenshots/.
 *
 * Not part of the default test run — opt in with `npm run screenshots`.
 */
import { test, expect, Page } from '@playwright/test';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const COLLECTION_NAME = 'Pet Store API';
const ENV_NAME = 'Production';

const sb = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function deleteByName(table: string, nameField: string, value: string) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${nameField}=eq.${encodeURIComponent(value)}`,
    { method: 'DELETE', headers: sb }
  );
}

async function cleanup() {
  await deleteByName('collections', 'name', COLLECTION_NAME);
  await deleteByName('environments', 'name', ENV_NAME);
}

async function waitForAppReady(page: Page) {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  await page.evaluate(() => {
    const toast = document.querySelector('.version-toast');
    if (toast) (toast as HTMLElement).style.display = 'none';
  });
}

async function createCollection(page: Page, name: string) {
  const addBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addBtn).toBeEnabled({ timeout: 10000 });
  await addBtn.click();
  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible({ timeout: 5000 });
  await promptModal.locator('.prompt-input').fill(name);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();
  await expect(page.locator('.collection-header').filter({ hasText: name })).toBeVisible({ timeout: 5000 });
}

async function addRequestInCollection(page: Page, collectionName: string, requestName: string, method: string, url: string) {
  const header = page.locator('.collection-header').filter({ hasText: collectionName });
  await header.hover();
  await header.locator('.btn-menu').click();
  await page.locator('.collection-menu').locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

  // Rename via sidebar context menu (the freshly-created request is named "New Request")
  const newReqItem = page.locator('.request-item').filter({
    has: page.locator('.request-name', { hasText: /^New Request$/ }),
  }).last();
  await newReqItem.hover();
  await newReqItem.locator('.btn-menu').click();
  await page.locator('.request-menu .request-menu-item').filter({ hasText: 'Rename' }).click();
  const renameInput = page.locator('.request-item .rename-input');
  await expect(renameInput).toBeVisible({ timeout: 3000 });
  await renameInput.fill(requestName);
  await renameInput.press('Enter');

  // Set method
  const methodTrigger = page.locator('.method-selector-trigger').first();
  await methodTrigger.click();
  await page.locator('.method-selector-option').filter({ hasText: new RegExp(`^${method}$`) }).first().click();

  // Set URL
  await page.locator('.url-input').fill(url);

  // Save
  const saveBtn = page.locator('.btn-save').first();
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('*', { timeout: 5000 });
}

async function createAndActivateEnvironment(page: Page, envName: string, vars: Array<{ key: string; value: string }>) {
  const envSelector = page.locator('.env-selector-trigger');
  await envSelector.click();
  await page.locator('.env-selector-edit').click();
  const envDrawer = page.locator('.env-drawer');
  await expect(envDrawer).toBeVisible({ timeout: 5000 });

  await envDrawer.locator('.env-list-header .btn-icon').click();
  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible({ timeout: 5000 });
  await promptModal.locator('.prompt-input').fill(envName);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();
  await expect(envDrawer.locator('.env-var-title')).toContainText(envName, { timeout: 5000 });

  for (const v of vars) {
    await envDrawer.locator('.btn-add-var').click();
    const newRow = envDrawer.locator('.env-var-table table tbody tr').first();
    await newRow.locator('input[placeholder="Variable name"]').fill(v.key);
    await newRow.locator('input[placeholder="Value"]').fill(v.value);
  }

  const saveBtn = envDrawer.locator('.btn-save');
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(saveBtn).toBeDisabled({ timeout: 10000 });
  // Let the post-save state sync before closing
  await page.waitForTimeout(500);

  await envDrawer.locator('.env-drawer-header .btn-icon[title="Close"]').click();
  // If a "Unsaved changes — Discard?" modal appears, click Discard so the drawer closes.
  const confirmDialog = page.locator('.confirm-modal');
  if (await confirmDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await confirmDialog.locator('button').filter({ hasText: /discard/i }).first().click();
  }
  await expect(envDrawer).not.toBeVisible({ timeout: 5000 });

  await envSelector.click();
  const envDropdown = page.locator('.env-selector-dropdown');
  await expect(envDropdown).toBeVisible();
  await envDropdown.locator('.env-selector-option').filter({ hasText: envName }).click();
  await expect(envSelector).toContainText(envName);
}

async function openRequestByName(page: Page, name: string) {
  const item = page.locator('.request-item').filter({ hasText: name }).first();
  await item.click();
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
  // Wait until the URL input reflects this request (avoid screenshotting a half-loaded tab)
  await page.waitForTimeout(300);
}

test.describe('Marketing screenshots — Pet Store API', () => {
  test.beforeAll(async () => {
    await cleanup();
  });

  test.afterAll(async () => {
    await cleanup();
  });

  test('seed-and-capture', async ({ page }) => {
    test.setTimeout(180_000);

    await waitForAppReady(page);

    // 1. Environment first (so {{baseUrl}} resolves immediately when we type URLs)
    await createAndActivateEnvironment(page, ENV_NAME, [
      { key: 'baseUrl', value: 'https://petstore3.swagger.io/api/v3' },
      { key: 'apiKey', value: 'demo_key_abc123' },
    ]);

    // 2. Collection + 5 requests
    await createCollection(page, COLLECTION_NAME);
    await addRequestInCollection(page, COLLECTION_NAME, 'List pets', 'GET', '{{baseUrl}}/pet/findByStatus?status=available');
    await addRequestInCollection(page, COLLECTION_NAME, 'Get pet by ID', 'GET', '{{baseUrl}}/pet/:petId');
    await addRequestInCollection(page, COLLECTION_NAME, 'Add pet', 'POST', '{{baseUrl}}/pet');
    await addRequestInCollection(page, COLLECTION_NAME, 'Update pet', 'PUT', '{{baseUrl}}/pet');
    await addRequestInCollection(page, COLLECTION_NAME, 'Delete pet', 'DELETE', '{{baseUrl}}/pet/:petId');

    // ── Screenshot 1: hero — sidebar + request editor on a path-var request
    await openRequestByName(page, 'Get pet by ID');
    // Set the petId path-var value so the curl/preview looks complete
    await page.locator('.request-tabs button').filter({ hasText: 'Params' }).click();
    const petIdValue = page.locator('[data-testid="path-variable-value-input-petId"] input').first();
    if (await petIdValue.count()) {
      await petIdValue.fill('10');
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/screenshots/01-hero.png', fullPage: false });

    // ── Screenshot 2: response viewer with formatted JSON
    const sendBtn = page.locator('.btn-send');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    // Wait for the request to complete (Send→Cancel→Send transition)
    await expect(page.locator('.btn-cancel-request')).toHaveCount(0, { timeout: 30000 });
    await expect(sendBtn).toBeEnabled({ timeout: 5000 });
    // Wait for response body to render
    await expect(page.locator('.response-viewer')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'docs/screenshots/02-response.png', fullPage: false });

    // ── Screenshot 3: cURL preview (shows substitution + readable shell command)
    const curlBtn = page.locator('.btn-copy-curl');
    if (await curlBtn.isVisible().catch(() => false)) {
      const className = (await curlBtn.getAttribute('class')) || '';
      if (!className.includes('active')) await curlBtn.click();
      await expect(page.locator('.curl-panel')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: 'docs/screenshots/03-curl.png', fullPage: false });
      // Close curl panel for next shot
      await curlBtn.click();
      await expect(page.locator('.curl-panel')).not.toBeVisible({ timeout: 3000 });
    }

    // ── Screenshot 4: environment editor
    const envSelector = page.locator('.env-selector-trigger');
    await envSelector.click();
    await page.locator('.env-selector-edit').click();
    await expect(page.locator('.env-drawer')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/screenshots/04-environment.png', fullPage: false });

    // Cleanup any open drawer so the spec ends in a tidy state
    await page.locator('.env-drawer-header .btn-icon[title="Close"]').click().catch(() => {});
    const tidyDialog = page.locator('.confirm-modal');
    if (await tidyDialog.isVisible({ timeout: 800 }).catch(() => false)) {
      await tidyDialog.locator('button').filter({ hasText: /discard/i }).first().click().catch(() => {});
    }
  });
});
