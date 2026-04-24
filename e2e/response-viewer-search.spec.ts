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
 * With the new Feature 2 default (all-expanded), strings inside slides[1].items ARE visible
 * immediately. For tests that need "find something that isn't rendered", we click Collapse-all first.
 */
const DEEP_JSON_URL = 'https://httpbin.org/json';
// A string that only appears inside httpbin.org/json at depth 4 (slides[1].items[0]).
const DEEP_TEXT_FRAGMENT = 'WonderWidgets';
// The only top-level key in httpbin.org/json's response.
const ROOT_KEY = 'slideshow';

test.describe('Response viewer — JSON search dock', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  // 1
  test('dock-visible-for-json', async ({ page }) => {
    const collectionName = uniqueName('Search Dock JSON Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });
  });

  // 2
  test('dock-hidden-for-html', async ({ page }) => {
    const collectionName = uniqueName('Search Dock HTML Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://httpbin.org/html');
    await sendRequestAndWaitForResponse(page);

    // Sanity: HTML preview toggle present — response rendered as HTML not JSON-through-error.
    await expect(page.locator('[data-testid="html-view-toggle"]')).toBeVisible({ timeout: 10000 });

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toHaveCount(0);
  });

  // 3
  test('dock-hidden-in-example', async ({ page }) => {
    const collectionName = uniqueName('Search Dock Example Collection');
    const exampleName = uniqueName('Search Dock Example');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);

    // Save the request first so it has an ID.
    const saveBtn = page.locator('.btn-save');
    await saveBtn.click();
    await expect(saveBtn).not.toContainText('*', { timeout: 5000 });

    await sendRequestAndWaitForResponse(page);

    // Sanity: dock visible in request mode before switching to example.
    await expect(page.locator('[data-testid="response-json-dock"]')).toBeVisible({ timeout: 10000 });

    await saveAsExample(page, exampleName);

    await page.waitForTimeout(500);
    const exampleTab = page.locator('.open-tab').filter({ hasText: exampleName });
    await expect(exampleTab).toBeVisible({ timeout: 10000 });
    await exampleTab.click();

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toHaveCount(0);
  });

  // 4
  test('dock-shows-three-icons-at-rest', async ({ page }) => {
    const collectionName = uniqueName('Search Dock Three Icons Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    // All three control buttons live INSIDE the dock at rest.
    await expect(dock.locator('[data-testid="response-search-btn"]')).toBeVisible();
    await expect(dock.locator('[data-testid="response-expand-all-btn"]')).toBeVisible();
    await expect(dock.locator('[data-testid="response-collapse-all-btn"]')).toBeVisible();

    // They must NOT exist inside `.response-meta`.
    const meta = page.locator('.response-viewer .response-meta');
    await expect(meta.locator('[data-testid="response-search-btn"]')).toHaveCount(0);
    await expect(meta.locator('[data-testid="response-expand-all-btn"]')).toHaveCount(0);
    await expect(meta.locator('[data-testid="response-collapse-all-btn"]')).toHaveCount(0);
  });

  // 5
  test('toolbar-still-has-download-only', async ({ page }) => {
    const collectionName = uniqueName('Toolbar Download Only Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const meta = page.locator('.response-viewer .response-meta');
    await expect(meta).toBeVisible({ timeout: 10000 });
    await expect(meta.locator('[data-testid="response-download-btn"]')).toBeVisible();

    // Expand / collapse test-ids moved into the dock — not in .response-meta anymore.
    await expect(meta.locator('[data-testid="response-expand-all-btn"]')).toHaveCount(0);
    await expect(meta.locator('[data-testid="response-collapse-all-btn"]')).toHaveCount(0);
  });

  // 6
  test('icon-click-opens-search-bar', async ({ page }) => {
    const collectionName = uniqueName('Search Icon Click Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();

    const input = page.locator('[data-testid="response-search-input"]');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // Counter is an inline span and renders empty text until the user types
    // (so `toBeVisible` reports "hidden" on empty inline content). Assert it's
    // in the DOM instead — presence is what matters here.
    await expect(page.locator('[data-testid="response-search-count"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="response-search-prev"]')).toBeVisible();
    await expect(page.locator('[data-testid="response-search-next"]')).toBeVisible();
    await expect(page.locator('[data-testid="response-search-close"]')).toBeVisible();
  });

  // 7
  test('ctrlf-opens-search-inside-viewer', async ({ page }) => {
    const collectionName = uniqueName('Ctrl-F Inside Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    // Focus inside the viewer.
    await page.locator('.response-viewer .json-view-wrapper').first().click();

    await page.keyboard.press('Control+f');

    const input = page.locator('[data-testid="response-search-input"]');
    await expect(input).toBeVisible({ timeout: 5000 });
    await expect(input).toBeFocused();
  });

  // 8
  test('ctrlf-outside-viewer-noop', async ({ page }) => {
    const collectionName = uniqueName('Ctrl-F Outside Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    // Focus the sidebar's search input (outside the response viewer).
    const sidebarSearch = page.locator('[data-testid="sidebar-search-input"]');
    await expect(sidebarSearch).toBeVisible();
    await sidebarSearch.click();

    await page.keyboard.press('Control+f');

    // Response search bar must NOT appear — browser Find would open natively, our hotkey is inert.
    const input = page.locator('[data-testid="response-search-input"]');
    await expect(input).toHaveCount(0);
  });

  // 9
  test('default-render-is-expanded', async ({ page }) => {
    const collectionName = uniqueName('Default Expanded Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const jsonWrap = page.locator('.json-view-wrapper');
    await expect(jsonWrap).toBeVisible({ timeout: 10000 });

    // With Feature 2, default is fully expanded — deep string is visible with no user action.
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false }).first())
      .toBeVisible({ timeout: 10000 });
  });

  // 10
  test('finds-match-after-collapse-all', async ({ page }) => {
    const collectionName = uniqueName('Find After Collapse Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const jsonWrap = page.locator('.json-view-wrapper');
    await expect(jsonWrap).toBeVisible({ timeout: 10000 });

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible();

    // Collapse everything so the deep string is out of the DOM.
    await dock.locator('[data-testid="response-collapse-all-btn"]').click();
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false })).toHaveCount(0);

    // Open search and query for it — force-expand must re-insert it wrapped in a <mark>.
    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await expect(input).toBeFocused();
    await input.fill(DEEP_TEXT_FRAGMENT);

    // At least one highlighted match exists and is visible in the DOM.
    const highlights = page.locator('mark.response-search-highlight[data-search-hit="true"]');
    await expect(highlights.first()).toBeVisible({ timeout: 10000 });
  });

  // 11
  test('number-substring-match', async ({ page }) => {
    const collectionName = uniqueName('Number Substring Collection');
    await createTestRequest(page, collectionName);

    // httpbin.org/anything echoes query params as string values in the `args` object.
    // So "num": "12345" is present as a string in the response body. Query "34" matches.
    await page.locator('.url-input').fill('https://httpbin.org/anything?num=12345');
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await expect(input).toBeFocused();
    await input.fill('34');

    const highlights = page.locator('mark.response-search-highlight[data-search-hit="true"]');
    await expect(highlights.first()).toBeVisible({ timeout: 10000 });
  });

  // 12
  // Boolean fixture: httpbin.org/anything does not stably reflect boolean tokens in its
  // JSON body (query params echo as strings, not booleans). Without an app-local fixture
  // endpoint that returns a JSON boolean leaf, we cannot deterministically test the
  // `<JsonView.True/False>` render path against a real backend. Mark as fixme per spec.
  test.fixme('boolean-substring-match', async ({ page }) => {
    // TODO(Agent B / eFrank): provide a stable JSON fixture with a boolean leaf (e.g.
    // { "active": true }) via a local test endpoint or by extending the proxy. Then
    // query "tru" and assert a <mark> appears around the "tru" substring of the rendered
    // `true` token.
    const collectionName = uniqueName('Boolean Substring Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill('https://example.invalid/boolean-fixture');
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });
    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await input.fill('tru');

    const highlights = page.locator('mark.response-search-highlight[data-search-hit="true"]');
    await expect(highlights.first()).toBeVisible({ timeout: 10000 });
  });

  // 13
  test('key-substring-match', async ({ page }) => {
    const collectionName = uniqueName('Key Substring Collection');
    await createTestRequest(page, collectionName);

    // httpbin.org/json has key `author` at slideshow.author. Crucially, "author"
    // does NOT appear as a substring in any value in that fixture — so a match
    // here proves the KeyName highlighter is wired correctly (previous "slide"
    // query coincidentally matched the VALUE "Sample Slide Show", masking a key
    // highlighter bug).
    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await input.fill('author');

    const highlights = page.locator('mark.response-search-highlight[data-search-hit="true"]');
    await expect(highlights.first()).toBeVisible({ timeout: 10000 });
    // Counter must read at least 1 — exercises the match-count plumbing too.
    const count = page.locator('[data-testid="response-search-count"]');
    await expect(count).toContainText(/^\d+ \/ \d+/);
  });

  // 14
  test('case-insensitive', async ({ page }) => {
    const collectionName = uniqueName('Case Insensitive Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');

    const marks = page.locator('mark.response-search-highlight[data-search-hit="true"]');

    // Wait for the JsonView to settle (key-bump remount + render-prop highlights)
    // before reading the count — otherwise .count() races React's render cycle.
    await input.fill('wonder');
    await expect(marks.first()).toBeVisible({ timeout: 5000 });
    const lowerCount = await marks.count();
    expect(lowerCount).toBeGreaterThan(0);

    await input.fill('');
    await input.fill('WONDER');
    await expect(marks.first()).toBeVisible({ timeout: 5000 });
    const upperCount = await marks.count();
    expect(upperCount).toBe(lowerCount);

    await input.fill('');
    await input.fill('Wonder');
    await expect(marks.first()).toBeVisible({ timeout: 5000 });
    const mixedCount = await marks.count();
    expect(mixedCount).toBe(lowerCount);
  });

  // 15
  test('counter-format', async ({ page }) => {
    const collectionName = uniqueName('Counter Format Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    const counter = page.locator('[data-testid="response-search-count"]');

    // Empty query → counter empty.
    await expect(counter).toHaveText('');

    // Query with no matches → 0 / 0.
    await input.fill('zzzz-nomatch-zzzz');
    await expect(counter).toHaveText('0 / 0');

    // Query with matches → "N / M" format, N active 1-based.
    await input.fill('');
    await input.fill('WonderWidgets');
    await expect(counter).toHaveText(/^1 \/ \d+$/);
  });

  // 16
  test('next-wraps-from-last', async ({ page }) => {
    const collectionName = uniqueName('Next Wrap Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    const counter = page.locator('[data-testid="response-search-count"]');
    const nextBtn = page.locator('[data-testid="response-search-next"]');

    await input.fill('WonderWidgets');
    await expect(counter).toHaveText(/^1 \/ \d+$/);

    const text = (await counter.textContent()) || '';
    const total = parseInt(text.split('/')[1].trim(), 10);
    expect(total).toBeGreaterThanOrEqual(1);

    // Click next (total-1) times to reach the last match (index total/total).
    for (let i = 0; i < total - 1; i++) {
      await nextBtn.click();
    }
    await expect(counter).toHaveText(new RegExp(`^${total} \\/ ${total}$`));

    // One more click → wraps to 1 / total.
    await nextBtn.click();
    await expect(counter).toHaveText(new RegExp(`^1 \\/ ${total}$`));
  });

  // 17
  test('prev-wraps-from-first', async ({ page }) => {
    const collectionName = uniqueName('Prev Wrap Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    const counter = page.locator('[data-testid="response-search-count"]');
    const prevBtn = page.locator('[data-testid="response-search-prev"]');

    await input.fill('WonderWidgets');
    await expect(counter).toHaveText(/^1 \/ \d+$/);

    const text = (await counter.textContent()) || '';
    const total = parseInt(text.split('/')[1].trim(), 10);
    expect(total).toBeGreaterThanOrEqual(1);

    // At index 1 → prev wraps to total.
    await prevBtn.click();
    await expect(counter).toHaveText(new RegExp(`^${total} \\/ ${total}$`));
  });

  // 18
  test('enter-advances-shift-enter-retreats', async ({ page }) => {
    const collectionName = uniqueName('Enter Navigation Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    const counter = page.locator('[data-testid="response-search-count"]');

    await input.fill('WonderWidgets');
    await expect(counter).toHaveText(/^1 \/ \d+$/);

    const text = (await counter.textContent()) || '';
    const total = parseInt(text.split('/')[1].trim(), 10);

    if (total >= 2) {
      // Enter advances 1 → 2.
      await input.focus();
      await page.keyboard.press('Enter');
      await expect(counter).toHaveText(new RegExp(`^2 \\/ ${total}$`));

      // Shift+Enter retreats 2 → 1.
      await page.keyboard.press('Shift+Enter');
      await expect(counter).toHaveText(new RegExp(`^1 \\/ ${total}$`));
    } else {
      // total === 1: Enter should wrap 1 → 1.
      await input.focus();
      await page.keyboard.press('Enter');
      await expect(counter).toHaveText(/^1 \/ 1$/);

      await page.keyboard.press('Shift+Enter');
      await expect(counter).toHaveText(/^1 \/ 1$/);
    }
  });

  // 19
  test('active-highlight-unique', async ({ page }) => {
    const collectionName = uniqueName('Active Highlight Unique Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await input.fill('WonderWidgets');

    // Wait for the first highlight to render, THEN assert the active-class
    // effect has picked exactly one of them. Without this wait the post-render
    // effect might race with the test snapshot.
    await expect(
      page.locator('mark.response-search-highlight[data-search-hit="true"]').first()
    ).toBeVisible({ timeout: 5000 });
    await expect(page.locator('mark.response-search-highlight--active')).toHaveCount(1);

    // Advance and re-check uniqueness.
    await page.locator('[data-testid="response-search-next"]').click();
    await expect(page.locator('mark.response-search-highlight--active')).toHaveCount(1);
  });

  // 20
  test('escape-closes-search', async ({ page }) => {
    const collectionName = uniqueName('Escape Closes Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await input.fill('WonderWidgets');
    await expect(page.locator('mark.response-search-highlight[data-search-hit="true"]').first())
      .toBeVisible({ timeout: 5000 });

    await input.focus();
    await page.keyboard.press('Escape');

    // Search bar gone, dock back to 3 icons, no highlights remain.
    await expect(page.locator('[data-testid="response-search-input"]')).toHaveCount(0);
    await expect(dock.locator('[data-testid="response-search-btn"]')).toBeVisible();
    await expect(dock.locator('[data-testid="response-expand-all-btn"]')).toBeVisible();
    await expect(dock.locator('[data-testid="response-collapse-all-btn"]')).toBeVisible();
    await expect(page.locator('mark.response-search-highlight[data-search-hit="true"]')).toHaveCount(0);
  });

  // 21
  test('close-button-closes', async ({ page }) => {
    const collectionName = uniqueName('Close Button Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await input.fill('WonderWidgets');
    await expect(page.locator('mark.response-search-highlight[data-search-hit="true"]').first())
      .toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="response-search-close"]').click();

    await expect(page.locator('[data-testid="response-search-input"]')).toHaveCount(0);
    await expect(dock.locator('[data-testid="response-search-btn"]')).toBeVisible();
    await expect(page.locator('mark.response-search-highlight[data-search-hit="true"]')).toHaveCount(0);
  });

  // 22
  test('new-response-closes-search', async ({ page }) => {
    const collectionName = uniqueName('New Response Closes Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await input.fill('WonderWidgets');
    await expect(page.locator('mark.response-search-highlight[data-search-hit="true"]').first())
      .toBeVisible({ timeout: 5000 });

    // Re-send the request → new response → search should auto-close.
    await page.locator('.btn-send').click();
    await expect(page.locator('.response-viewer.loading')).not.toBeVisible({ timeout: 30000 });
    await expect(page.locator('.json-view-wrapper')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('[data-testid="response-search-input"]')).toHaveCount(0);
    await expect(page.locator('mark.response-search-highlight[data-search-hit="true"]')).toHaveCount(0);
    // Dock back to rest state.
    await expect(dock.locator('[data-testid="response-search-btn"]')).toBeVisible();
  });

  // 23
  test('collapse-all-via-dock-then-expand-all', async ({ page }) => {
    const collectionName = uniqueName('Dock Expand Collapse Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(DEEP_JSON_URL);
    await sendRequestAndWaitForResponse(page);

    const jsonWrap = page.locator('.json-view-wrapper');
    await expect(jsonWrap).toBeVisible({ timeout: 10000 });

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible();

    // Default is expanded — deep text visible. Click Collapse-all → gone.
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false }).first())
      .toBeVisible({ timeout: 10000 });
    await dock.locator('[data-testid="response-collapse-all-btn"]').click();
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false })).toHaveCount(0);
    // Root key still present so we know it's a collapse, not an unmount.
    await expect(jsonWrap.getByText(ROOT_KEY, { exact: false }).first()).toBeVisible();

    // Click Expand-all → deep text back.
    await dock.locator('[data-testid="response-expand-all-btn"]').click();
    await expect(jsonWrap.getByText(DEEP_TEXT_FRAGMENT, { exact: false }).first())
      .toBeVisible({ timeout: 10000 });
  });
});
