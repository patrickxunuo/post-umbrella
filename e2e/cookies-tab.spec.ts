import { test, expect, Page } from '@playwright/test';
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

// httpbin echoes the requested header back as a real response header, with no redirect.
// The proxy un-folds Set-Cookie into `result.setCookies`, so the Cookies tab can read it.
const SET_COOKIE_URL =
  'https://httpbin.org/response-headers?Set-Cookie=e2e_sid%3Dabc123%3B%20Path%3D%2F';
const NO_COOKIE_URL = 'https://httpbin.org/get';

test.describe('Response viewer — Cookies tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  // 1 — Tab appears for a Set-Cookie response and lists the cookie.
  test('cookies-tab-appears-and-lists-cookie', async ({ page }) => {
    const collectionName = uniqueName('Cookies Tab Set-Cookie Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(SET_COOKIE_URL);
    await sendRequestAndWaitForResponse(page);

    const cookiesTab = page.locator('[data-testid="response-tab-cookies"]');
    await expect(cookiesTab).toBeVisible({ timeout: 10000 });

    await cookiesTab.click();

    const cookiesTable = page.locator('[data-testid="response-cookies"]');
    await expect(cookiesTable).toBeVisible();

    const rows = cookiesTable.locator('[data-testid="cookie-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('e2e_sid');
    await expect(rows.first()).toContainText('abc123');
  });

  // 2 — Tab is absent for a response that set no cookies.
  test('cookies-tab-hidden-without-set-cookie', async ({ page }) => {
    const collectionName = uniqueName('Cookies Tab No-Cookie Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(NO_COOKIE_URL);
    await sendRequestAndWaitForResponse(page);

    await expect(page.locator('[data-testid="response-tab-cookies"]')).toHaveCount(0);
  });

  // 3 — Switching Body / Headers / Cookies preserves the response (no refetch / reset).
  test('switching-tabs-preserves-response', async ({ page }) => {
    const collectionName = uniqueName('Cookies Tab Switch Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(SET_COOKIE_URL);
    await sendRequestAndWaitForResponse(page);

    const tabs = page.locator('.response-tabs');
    const cookiesTab = page.locator('[data-testid="response-tab-cookies"]');
    await expect(cookiesTab).toBeVisible({ timeout: 10000 });

    // Cookies → Headers → Body → Cookies; the cookie row survives the round trip.
    await cookiesTab.click();
    await expect(page.locator('[data-testid="cookie-row"]').first()).toContainText('e2e_sid');

    await tabs.getByRole('button', { name: 'Headers' }).click();
    await expect(page.locator('.response-headers')).toBeVisible();

    await tabs.getByRole('button', { name: 'Body' }).click();

    await cookiesTab.click();
    await expect(page.locator('[data-testid="cookie-row"]').first()).toContainText('e2e_sid');
  });

  // 4 — A saved Example without cookie data must not show the tab.
  test('cookies-tab-hidden-in-example', async ({ page }) => {
    const collectionName = uniqueName('Cookies Tab Example Collection');
    const exampleName = uniqueName('Cookies Tab Example');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(NO_COOKIE_URL);

    // Save the request first so it has an ID to attach the example to.
    const saveBtn = page.locator('.btn-save');
    await saveBtn.click();
    await expect(saveBtn).not.toContainText('*', { timeout: 5000 });

    await sendRequestAndWaitForResponse(page);
    await saveAsExample(page, exampleName);

    await page.waitForTimeout(500);
    const exampleTab = page.locator('.open-tab').filter({ hasText: exampleName });
    await expect(exampleTab).toBeVisible({ timeout: 10000 });
    await exampleTab.click();

    await expect(page.locator('[data-testid="response-tab-cookies"]')).toHaveCount(0);
  });
});
