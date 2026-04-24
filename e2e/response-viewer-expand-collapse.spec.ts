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

/**
 * httpbin.org/json returns a stable, 4-level-deep payload:
 *   { slideshow: { author, date, title, slides: [ {title, type}, {title, type, items: [string, string]} ] } }
 * With the default collapsed={2}, strings inside slides[1].items are NOT visible
 * (they live at depth 4). Expand-all must reveal them; Collapse-all must hide
 * everything below the single root key "slideshow".
 */
const DEEP_JSON_URL = 'https://httpbin.org/json';
// A string that only appears inside httpbin.org/json at depth 4 (slides[1].items[0]).
const DEEP_TEXT_FRAGMENT = 'WonderWidgets';
// A key that only appears at depth 3 (inside slides[1]).
const DEPTH_3_KEY = 'items';
// The only top-level key in httpbin.org/json's response.
const ROOT_KEY = 'slideshow';

test.describe('Response viewer — expand/collapse all', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  // Test 1 — Buttons are visible on a JSON response.
  test('expand-collapse-visible-for-json', async ({ page }) => {
    const collectionName = uniqueName('Expand Collapse Visible Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const expandBtn = page.locator('[data-testid="response-expand-all-btn"]');
    const collapseBtn = page.locator('[data-testid="response-collapse-all-btn"]');

    await expect(expandBtn).toBeVisible({ timeout: 10000 });
    await expect(collapseBtn).toBeVisible({ timeout: 10000 });
  });

  // Test 2 — Buttons are hidden on HTML (non-JSON) responses.
  test('expand-collapse-hidden-for-html', async ({ page }) => {
    const collectionName = uniqueName('Expand Collapse HTML Collection');
    await createTestRequest(page, collectionName);

    // httpbin.org/html returns text/html — matches e2e/html-preview.spec.ts convention.
    await page.locator('.url-input').fill('https://httpbin.org/html');
    await sendRequestAndWaitForResponse(page);

    // Sanity: HTML preview toggle should be present so we know the response landed
    // as HTML and not JSON-through-error.
    const htmlToggle = page.locator('[data-testid="html-view-toggle"]');
    await expect(htmlToggle).toBeVisible({ timeout: 10000 });

    const expandBtn = page.locator('[data-testid="response-expand-all-btn"]');
    const collapseBtn = page.locator('[data-testid="response-collapse-all-btn"]');

    await expect(expandBtn).toHaveCount(0);
    await expect(collapseBtn).toHaveCount(0);
  });

  // Test 3 — Buttons are hidden in example-editing mode.
  test('expand-collapse-hidden-in-example', async ({ page }) => {
    const collectionName = uniqueName('Expand Collapse Example Collection');
    const exampleName = uniqueName('Expand Collapse Example');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);

    // Save the request first so it has an ID.
    const saveBtn = page.locator('.btn-save');
    await saveBtn.click();
    await expect(saveBtn).not.toContainText('*', { timeout: 5000 });

    await sendRequestAndWaitForResponse(page);

    // Sanity: buttons visible in request mode before we turn this into an example.
    await expect(page.locator('[data-testid="response-expand-all-btn"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="response-collapse-all-btn"]')).toBeVisible({ timeout: 10000 });

    await saveAsExample(page, exampleName);

    // Wait for example tab to open, then switch to it (matches e2e/example.spec.ts pattern).
    await page.waitForTimeout(500);
    const exampleTab = page.locator('.open-tab').filter({ hasText: exampleName });
    await expect(exampleTab).toBeVisible({ timeout: 10000 });
    await exampleTab.click();

    // In example mode neither button may be rendered.
    const expandBtn = page.locator('[data-testid="response-expand-all-btn"]');
    const collapseBtn = page.locator('[data-testid="response-collapse-all-btn"]');
    await expect(expandBtn).toHaveCount(0);
    await expect(collapseBtn).toHaveCount(0);
  });

  // Test 4 — Collapse-all collapses every level; only root-level keys remain.
  test('collapse-all-collapses-nested', async ({ page }) => {
    const collectionName = uniqueName('Collapse Nested Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const jsonWrap = page.locator('.json-view-wrapper');
    await expect(jsonWrap).toBeVisible({ timeout: 10000 });

    // First expand everything so depth-3+ nodes are rendered.
    const expandBtn = page.locator('[data-testid="response-expand-all-btn"]');
    await expect(expandBtn).toBeVisible();
    await expandBtn.click();
    // Deep string now visible inside slides[1].items (depth 4).
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false }).first()).toBeVisible({ timeout: 10000 });

    // Now collapse everything — deep text and depth-3 key must disappear.
    const collapseBtn = page.locator('[data-testid="response-collapse-all-btn"]');
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();

    // Deep string: must have zero occurrences in the DOM after full collapse.
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false })).toHaveCount(0);
    // Depth-3 key `items` should also be gone.
    await expect(jsonWrap.getByText(DEPTH_3_KEY, { exact: false })).toHaveCount(0);
    // (Note: the library's collapsed={true} hides even root-level key names,
    // showing just `{...}` at the top. No assertion on root-key visibility.)
  });

  // Test 5 — Expand-all reveals nodes beyond the default collapse depth.
  // Updated for Feature 2: default is now fully expanded, so the original "deep text
  // absent initially" assertion is no longer meaningful. Instead, we collapse first,
  // verify deep text is gone, then expand-all and verify it comes back.
  test('expand-all-reveals-deep-nodes', async ({ page }) => {
    const collectionName = uniqueName('Expand Deep Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const jsonWrap = page.locator('.json-view-wrapper');
    await expect(jsonWrap).toBeVisible({ timeout: 10000 });

    // Click Collapse-all so depth-4 content is removed from the DOM.
    const collapseBtn = page.locator('[data-testid="response-collapse-all-btn"]');
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false })).toHaveCount(0);

    // Click Expand-all — depth-4 string and depth-3 `items` key become visible again.
    const expandBtn = page.locator('[data-testid="response-expand-all-btn"]');
    await expect(expandBtn).toBeVisible();
    await expandBtn.click();

    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(jsonWrap.getByText(DEPTH_3_KEY, { exact: false }).first()).toBeVisible();
  });

  // Test 6 — Collapse mode resets when a new response arrives.
  // Updated for Feature 2: default is now 'all-expanded' (not 'default' / collapsed={2}).
  // So after re-sending, the viewer is fully expanded again — any previous Collapse-all
  // state must NOT carry over.
  test('reset-on-new-response', async ({ page }) => {
    const collectionName = uniqueName('Reset New Response Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const jsonWrap = page.locator('.json-view-wrapper');
    await expect(jsonWrap).toBeVisible({ timeout: 10000 });

    // Default is expanded — click Collapse-all to put the viewer into all-collapsed.
    const collapseBtn = page.locator('[data-testid="response-collapse-all-btn"]');
    await collapseBtn.click();
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false })).toHaveCount(0);

    // Re-send the request. Reset should flip collapseMode back to 'all-expanded'.
    await page.locator('.btn-send').click();
    await expect(page.locator('.response-viewer.loading')).not.toBeVisible({ timeout: 30000 });
    await expect(page.locator('.json-view-wrapper')).toBeVisible({ timeout: 10000 });

    // With all-expanded restored, the deep (depth-4) string is visible again — the
    // previous collapse state did NOT persist across the new response.
    const jsonWrapAfter = page.locator('.json-view-wrapper');
    await expect(jsonWrapAfter.getByText(DEEP_TEXT_FRAGMENT, { exact: false }).first())
      .toBeVisible({ timeout: 10000 });
    await expect(jsonWrapAfter.getByText(ROOT_KEY, { exact: false }).first()).toBeVisible();
  });

  // Test 7 — The three toolbar buttons coexist and the Download button still works.
  test('download-button-coexists', async ({ page }) => {
    const collectionName = uniqueName('Download Coexists Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const expandBtn = page.locator('[data-testid="response-expand-all-btn"]');
    const collapseBtn = page.locator('[data-testid="response-collapse-all-btn"]');
    const downloadBtn = page.locator('[data-testid="response-download-btn"]');

    await expect(expandBtn).toBeVisible({ timeout: 10000 });
    await expect(collapseBtn).toBeVisible({ timeout: 10000 });
    await expect(downloadBtn).toBeVisible({ timeout: 10000 });

    // Download button still functional — a download event must fire when clicked.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      downloadBtn.click(),
    ]);
    expect(download.suggestedFilename().length).toBeGreaterThan(0);
  });
});
