import { test, expect, Page, Locator } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';
import { startJsonFixtureServer, TYPES_FIXTURE, PLAIN_TEXT_FIXTURE } from './helpers/jsonFixtureServer';

// GH-70: row-virtualized JSON tree view for response bodies (FE-001..FE-011).
//
// Transport boundary: the fixture server lives in this Playwright worker process
// and is bound to http://127.0.0.1:<port>. The app classifies 127.0.0.1 as a
// local address, so its transport fetches the URL straight from the browser
// (window.fetch) — the Supabase proxy Edge Function is never involved. Every
// other part of the stack is real: the real app at baseURL, the real Supabase
// backend for collections/requests, the real browser clipboard. No page.route().

const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

let fixture: { baseUrl: string; close(): Promise<void> };

test.beforeAll(async () => {
  fixture = await startJsonFixtureServer();
});

test.afterAll(async () => {
  await fixture?.close();
  await cleanupTestCollections(timestamp);
});

// --- Shared helpers (mirrored from the existing E2E suite's conventions) ---

const SIDEBAR_TIMEOUT = 15000;

/**
 * The header actions are visibility:hidden until hovered, and a click never
 * re-hovers, so if the sidebar reflows under a stale hover the click would wait
 * forever. Retry hover + click together until the menu opens.
 */
async function openCollectionMenu(page: Page, collectionHeader: Locator) {
  const collectionMenu = page.locator('.collection-menu');
  await expect(async () => {
    await collectionHeader.hover();
    if (!(await collectionMenu.isVisible())) {
      await collectionHeader.locator('.btn-menu').click({ timeout: 2000 });
    }
    await expect(collectionMenu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: SIDEBAR_TIMEOUT });
  return collectionMenu;
}

async function createTestRequest(page: Page, collectionName: string) {
  const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
  await addCollectionBtn.click();

  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible({ timeout: 10000 });
  await promptModal.locator('.prompt-input').fill(collectionName);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();

  // Sidebar rows arrive via the real backend; allow for a loaded machine.
  const collectionHeader = page.locator('.collection-header').filter({ hasText: collectionName });
  await expect(collectionHeader).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
  const collectionMenu = await openCollectionMenu(page, collectionHeader);
  await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

  const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
  await expect(requestItem).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
}

/** Add a second request to an existing collection via its header menu (opens it in a new tab). */
async function addRequestToCollection(page: Page, collectionName: string) {
  const collectionHeader = page.locator('.collection-header').filter({ hasText: collectionName });
  await expect(collectionHeader).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
  const collectionMenu = await openCollectionMenu(page, collectionHeader);
  await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
}

async function sendRequestAndWaitForResponse(page: Page, timeout = 30000) {
  const sendButton = page.locator('.btn-send');
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const responseViewer = page.locator('.response-viewer').first();
  await expect(responseViewer).toBeVisible({ timeout });
  await expect(responseViewer.locator('.response-meta')).toBeVisible({ timeout });
  await expect(page.locator('.response-viewer.loading')).not.toBeVisible({ timeout });
}

async function sendUrl(page: Page, url: string, timeout = 30000) {
  await page.locator('.url-input').fill(url);
  await sendRequestAndWaitForResponse(page, timeout);
}

const MAX_MOUNTED_ROWS = 150;
const LARGE_MIN_ROWS = 100000;
const LARGE_TIMEOUT = 120000;

const tree = (page: Page) => page.locator('[data-testid="json-tree"]');
const rows = (page: Page) => page.locator('[data-testid="json-tree-row"]');
// A container's open row and its close row share the same data-path (node.id);
// rowByPath targets the open/leaf/empty row, closeRowByPath the close row.
const rowByPath = (page: Page, path: (string | number)[]) =>
  page.locator(`[data-testid="json-tree-row"][data-path='${JSON.stringify(path)}']:not([data-kind="close"])`);
const closeRowByPath = (page: Page, path: (string | number)[]) =>
  page.locator(`[data-testid="json-tree-row"][data-path='${JSON.stringify(path)}'][data-kind="close"]`);
const marks = (page: Page) => page.locator('mark.response-search-highlight[data-search-hit="true"]');

// Windows normalizes clipboard text to CRLF on read-back; compare with LF.
async function readClipboardLf(page: Page): Promise<string> {
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return text.replace(/\r\n/g, '\n');
}

async function totalRows(page: Page): Promise<number> {
  const attr = await tree(page).getAttribute('data-total-rows');
  expect(attr, 'json-tree must carry data-total-rows').not.toBeNull();
  return Number(attr);
}

async function waitForTree(page: Page, timeout = 10000) {
  await expect(tree(page)).toBeVisible({ timeout });
  await expect(tree(page)).toHaveAttribute('data-total-rows', /^\d+$/, { timeout });
}

// Waits until data-total-rows reports the large body's row count (polls the attribute).
async function waitForLargeTotalRows(page: Page, timeout = 60000) {
  await expect
    .poll(async () => Number(await tree(page).getAttribute('data-total-rows')), { timeout })
    .toBeGreaterThan(LARGE_MIN_ROWS);
}

const colorOf = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).color);

// Screenshots land in test-results/screenshots/json-tree-<id>-<step>.png when
// PAPERPLANE_CAPTURE_SCREENSHOTS=1 (set for this run).
const CAPTURE = process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === '1';
async function snap(page: Page, id: string, step: string) {
  if (!CAPTURE) return;
  await page.screenshot({ path: `test-results/screenshots/json-tree-${id}-${step}.png` });
}

/**
 * Scrolls the wrapper to its end inside the page and returns the elapsed ms until a
 * depth-0 close row is mounted (or -1 if it never appeared within `cap` ms).
 */
async function scrollToEndAndMeasure(page: Page, cap = 5000): Promise<number> {
  return tree(page).evaluate(async (el, capMs) => {
    const start = performance.now();
    el.scrollTop = el.scrollHeight;
    while (performance.now() - start < capMs) {
      if (el.querySelector('[data-kind="close"][data-depth="0"]')) return performance.now() - start;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return -1;
  }, cap);
}

/** Scrolls the wrapper back to the top and waits for the row with `path` to be mounted. */
async function scrollToTop(page: Page, path: (string | number)[]) {
  await tree(page).evaluate((el) => { el.scrollTop = 0; });
  await expect(rowByPath(page, path)).toBeVisible({ timeout: 10000 });
}

/**
 * Clicks a dock button from inside the page and returns the elapsed ms until
 * data-total-rows satisfies the mode ('one' → === '1'; 'large' → > 100000).
 * Returns -1 if it never happened within `cap` ms.
 */
async function clickDockAndMeasure(page: Page, testId: string, mode: 'one' | 'large', cap = 10000): Promise<number> {
  return page.evaluate(async ({ testId, mode, capMs, largeMin }) => {
    const btn = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    if (!btn) return -2;
    const read = () => document.querySelector('[data-testid="json-tree"]')?.getAttribute('data-total-rows') ?? null;
    const ok = (v: string | null) => (mode === 'one' ? v === '1' : Number(v) > largeMin);
    const start = performance.now();
    btn.click();
    while (performance.now() - start < capMs) {
      if (ok(read())) return performance.now() - start;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return -1;
  }, { testId, mode, capMs: cap, largeMin: LARGE_MIN_ROWS });
}

test.describe('Response viewer — row-virtualized JSON tree (GH-70)', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  // FE-001 — types.json: quoted keys, typed + colored values, arrows, badges, copy per non-close row.
  test('FE-001 types.json renders quoted keys, typed colored values, arrows, badges and copy controls', async ({ page }) => {
    await createTestRequest(page, uniqueName('VTree FE-001 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/types.json`);
    await waitForTree(page);
    await snap(page, 'FE-001', 'tree-visible');

    // Row count for the fixture follows directly from the flattening rules:
    // root open + 7 leaves + 2 empty + long leaf + nested(7) + list(5) + root close = 24.
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');

    // Quoted keys.
    await expect(rowByPath(page, ['str']).locator('[data-testid="json-tree-key"]')).toHaveText('"str"');
    await expect(rowByPath(page, ['nested']).locator('[data-testid="json-tree-key"]')).toHaveText('"nested"');
    await expect(rowByPath(page, ['nested', 'a', 'b', 'c']).locator('[data-testid="json-tree-key"]')).toHaveText('"c"');

    // Typed values with their JSON token text.
    const strVal = rowByPath(page, ['str']).locator('[data-testid="json-tree-value"]');
    const intVal = rowByPath(page, ['int']).locator('[data-testid="json-tree-value"]');
    const floatVal = rowByPath(page, ['float']).locator('[data-testid="json-tree-value"]');
    const negVal = rowByPath(page, ['neg']).locator('[data-testid="json-tree-value"]');
    const yesVal = rowByPath(page, ['yes']).locator('[data-testid="json-tree-value"]');
    const noVal = rowByPath(page, ['no']).locator('[data-testid="json-tree-value"]');
    const nullVal = rowByPath(page, ['nothing']).locator('[data-testid="json-tree-value"]');

    await expect(strVal).toHaveAttribute('data-type', 'string');
    await expect(strVal).toHaveText('"hello"');
    await expect(intVal).toHaveAttribute('data-type', 'int');
    await expect(intVal).toHaveText('42');
    await expect(floatVal).toHaveAttribute('data-type', 'float');
    await expect(floatVal).toHaveText('3.14');
    await expect(negVal).toHaveAttribute('data-type', 'int');
    await expect(negVal).toHaveText('-7');
    await expect(yesVal).toHaveAttribute('data-type', 'boolean');
    await expect(yesVal).toHaveText('true');
    await expect(noVal).toHaveAttribute('data-type', 'boolean');
    await expect(noVal).toHaveText('false');
    await expect(nullVal).toHaveAttribute('data-type', 'null');
    await expect(nullVal).toHaveText('null');

    // Computed colors per type and for keys.
    expect(await colorOf(strVal)).toBe('rgb(34, 197, 94)');
    expect(await colorOf(intVal)).toBe('rgb(245, 158, 11)');
    expect(await colorOf(floatVal)).toBe('rgb(245, 158, 11)');
    expect(await colorOf(yesVal)).toBe('rgb(139, 92, 246)');
    expect(await colorOf(nullVal)).toBe('rgb(239, 68, 68)');
    expect(await colorOf(rowByPath(page, ['str']).locator('[data-testid="json-tree-key"]'))).toBe('rgb(14, 165, 233)');
    await snap(page, 'FE-001', 'colors');

    // Arrows only on container open rows.
    const nestedArrow = rowByPath(page, ['nested']).locator('[data-testid="json-tree-arrow"]');
    const listArrow = rowByPath(page, ['list']).locator('[data-testid="json-tree-arrow"]');
    await expect(nestedArrow).toHaveCount(1);
    await expect(nestedArrow).toHaveAttribute('aria-expanded', 'true');
    await expect(nestedArrow).toHaveAttribute('aria-label', 'Collapse');
    await expect(listArrow).toHaveCount(1);
    await expect(listArrow).toHaveAttribute('aria-expanded', 'true');
    await expect(rowByPath(page, ['str']).locator('[data-testid="json-tree-arrow"]')).toHaveCount(0);
    await expect(rowByPath(page, ['emptyObj']).locator('[data-testid="json-tree-arrow"]')).toHaveCount(0);

    // Badges.
    await expect(rowByPath(page, ['list']).locator('[data-testid="json-tree-count"]')).toHaveText('3 items');
    await expect(rowByPath(page, ['nested']).locator('[data-testid="json-tree-count"]')).toHaveText('1 item');
    await expect(rowByPath(page, ['str']).locator('[data-testid="json-tree-count"]')).toHaveCount(0);

    // One copy control per non-close row, none on close rows.
    const nonCloseRows = page.locator('[data-testid="json-tree-row"]:not([data-kind="close"])');
    const closeRows = page.locator('[data-testid="json-tree-row"][data-kind="close"]');
    const nonCloseCount = await nonCloseRows.count();
    expect(nonCloseCount).toBeGreaterThan(0);
    expect(await closeRows.count()).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="json-tree-copy"]')).toHaveCount(nonCloseCount);
    await expect(closeRows.locator('[data-testid="json-tree-copy"]')).toHaveCount(0);
    for (let i = 0; i < nonCloseCount; i++) {
      await expect(nonCloseRows.nth(i).locator('[data-testid="json-tree-copy"]')).toHaveCount(1);
    }
    await expect(page.locator('[data-testid="json-tree-copy"]').first()).toHaveAttribute('aria-label', 'Copy');
    await expect(page.locator('[data-testid="json-tree-copy"]').first()).toHaveAttribute('data-copied', 'false');
    await snap(page, 'FE-001', 'controls');
  });

  // FE-002 — empty containers and long strings.
  test('FE-002 empty containers render {} / [] and long strings are never truncated', async ({ page }) => {
    await createTestRequest(page, uniqueName('VTree FE-002 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/types.json`);
    await waitForTree(page);

    const emptyObjRow = rowByPath(page, ['emptyObj']);
    const emptyArrRow = rowByPath(page, ['emptyArr']);
    await expect(emptyObjRow).toHaveAttribute('data-kind', 'empty');
    await expect(emptyArrRow).toHaveAttribute('data-kind', 'empty');
    await expect(emptyObjRow).toContainText('{}');
    await expect(emptyArrRow).toContainText('[]');
    await expect(emptyObjRow.locator('[data-testid="json-tree-count"]')).toHaveCount(0);
    await expect(emptyArrRow.locator('[data-testid="json-tree-count"]')).toHaveCount(0);
    await snap(page, 'FE-002', 'empty-containers');

    const longRow = rowByPath(page, ['long']);
    const longVal = longRow.locator('[data-testid="json-tree-value"]');
    await expect(longVal).toHaveAttribute('data-type', 'string');
    const longText = (await longVal.textContent()) ?? '';
    expect(longText.length).toBeGreaterThanOrEqual(2002);
    expect(longText).toBe(JSON.stringify(TYPES_FIXTURE.long));
    expect(longText).not.toContain('…');
    await expect(longRow.locator('.json-tree-ellipsis')).toHaveCount(0);
    await snap(page, 'FE-002', 'long-string');
  });

  // FE-003 — bounded DOM on a 10 MB body; scrolling to the end mounts the root close row within 1 s.
  test('FE-003 large.json keeps mounted rows bounded and scrolls to the end within 1 s', async ({ page }) => {
    test.setTimeout(LARGE_TIMEOUT);
    await createTestRequest(page, uniqueName('VTree FE-003 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/large.json`, 90000);
    await waitForTree(page, 60000);
    await waitForLargeTotalRows(page);
    await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
    await snap(page, 'FE-003', 'tree-visible');

    const total = await totalRows(page);
    expect(total).toBeGreaterThan(LARGE_MIN_ROWS);

    const mountedBefore = await rows(page).count();
    expect(mountedBefore).toBeGreaterThan(0);
    expect(mountedBefore).toBeLessThan(MAX_MOUNTED_ROWS);

    // The body height must reflect the virtualizer total (rows are absolutely positioned inside it).
    await expect(tree(page).locator('.json-tree-body')).toHaveCount(1);
    await expect(rowByPath(page, [])).toHaveAttribute('data-kind', 'open');
    await expect(rowByPath(page, [])).toHaveAttribute('data-depth', '0');

    const elapsed = await scrollToEndAndMeasure(page);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(1000);

    const closeRoot = page.locator('[data-testid="json-tree-row"][data-kind="close"][data-depth="0"]');
    await expect(closeRoot).toHaveCount(1);
    await expect(closeRoot).toBeVisible();
    expect(await rows(page).count()).toBeLessThan(MAX_MOUNTED_ROWS);
    // The top rows must have been unmounted by now.
    await expect(rowByPath(page, [])).toHaveCount(0);
    await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
    await snap(page, 'FE-003', 'scrolled-to-end');
  });

  // FE-004 — Collapse all / Expand all on the large body complete within 1 s each.
  test('FE-004 collapse all and expand all on large.json each complete within 1 s', async ({ page }) => {
    test.setTimeout(LARGE_TIMEOUT);
    await createTestRequest(page, uniqueName('VTree FE-004 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/large.json`, 90000);
    await waitForTree(page, 60000);
    await waitForLargeTotalRows(page);

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible();
    await expect(dock.locator('[data-testid="response-collapse-all-btn"]')).toBeVisible();
    await expect(dock.locator('[data-testid="response-expand-all-btn"]')).toBeVisible();

    const collapseMs = await clickDockAndMeasure(page, 'response-collapse-all-btn', 'one');
    expect(collapseMs).toBeGreaterThanOrEqual(0);
    expect(collapseMs).toBeLessThan(1000);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '1');
    await expect(rows(page)).toHaveCount(1);
    await expect(rowByPath(page, [])).toHaveAttribute('data-kind', 'open');
    await expect(rowByPath(page, [])).toHaveAttribute('data-expanded', 'false');
    await expect(rowByPath(page, []).locator('[data-testid="json-tree-arrow"]')).toHaveAttribute('aria-expanded', 'false');
    await expect(rowByPath(page, []).locator('.json-tree-ellipsis')).toHaveCount(1);
    await snap(page, 'FE-004', 'collapsed');

    const expandMs = await clickDockAndMeasure(page, 'response-expand-all-btn', 'large');
    expect(expandMs).toBeGreaterThanOrEqual(0);
    expect(expandMs).toBeLessThan(1000);
    expect(await totalRows(page)).toBeGreaterThan(LARGE_MIN_ROWS);
    await expect(rowByPath(page, [])).toHaveAttribute('data-expanded', 'true');
    expect(await rows(page).count()).toBeLessThan(MAX_MOUNTED_ROWS);
    await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
    await snap(page, 'FE-004', 'expanded');
  });

  // FE-005 — switching back to a tab holding the large body re-renders within 1 s, no error boundary.
  test('FE-005 switching back to the large-body tab renders its tree within 1 s without an error boundary', async ({ page }) => {
    test.setTimeout(LARGE_TIMEOUT);
    const collectionName = uniqueName('VTree FE-005 Collection');
    await createTestRequest(page, collectionName);
    await expect(page.locator('.open-tab')).toHaveCount(1, { timeout: 5000 });

    // Tab A: the large body.
    await sendUrl(page, `${fixture.baseUrl}/large.json`, 90000);
    await waitForTree(page, 60000);
    await waitForLargeTotalRows(page);
    await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
    await snap(page, 'FE-005', 'tab-a-large');

    // Tab B: a second request in the same collection with the small body.
    await addRequestToCollection(page, collectionName);
    await expect(page.locator('.open-tab')).toHaveCount(2, { timeout: 5000 });
    await sendUrl(page, `${fixture.baseUrl}/types.json`);
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');
    await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
    await snap(page, 'FE-005', 'tab-b-types');

    // Tab A is the one that is not active now.
    const inactiveTabs = page.locator('.open-tab:not(.active)');
    await expect(inactiveTabs).toHaveCount(1);
    const tabAIndex = await page.locator('.open-tab').evaluateAll((els) =>
      els.findIndex((el) => !el.classList.contains('active')));
    expect(tabAIndex).toBeGreaterThanOrEqual(0);

    // Click tab A from inside the page and measure until its tree reports the large row count.
    const switchMs = await page.evaluate(async ({ index, largeMin }) => {
      const tab = document.querySelectorAll('.open-tab')[index] as HTMLElement;
      const start = performance.now();
      tab.click();
      while (performance.now() - start < 10000) {
        const el = document.querySelector('[data-testid="json-tree"]');
        const total = Number(el?.getAttribute('data-total-rows') ?? 0);
        if (el && total > largeMin) return performance.now() - start;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return -1;
    }, { index: tabAIndex, largeMin: LARGE_MIN_ROWS });

    expect(switchMs).toBeGreaterThanOrEqual(0);
    expect(switchMs).toBeLessThan(1000);
    await expect(page.locator('.open-tab').nth(tabAIndex)).toHaveClass(/\bactive\b/);
    await expect(tree(page)).toBeVisible();
    expect(await totalRows(page)).toBeGreaterThan(LARGE_MIN_ROWS);
    expect(await rows(page).count()).toBeLessThan(MAX_MOUNTED_ROWS);
    await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
    await snap(page, 'FE-005', 'tab-a-again');
  });

  // FE-006 — per-node arrow toggles one node; state lives in React and survives scrolling away.
  test('FE-006 arrow click collapses one node only and the state survives scrolling away and back', async ({ page }) => {
    test.setTimeout(LARGE_TIMEOUT);
    await createTestRequest(page, uniqueName('VTree FE-006 Collection'));

    // Part 1: types.json.
    await sendUrl(page, `${fixture.baseUrl}/types.json`);
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');

    const nestedRow = rowByPath(page, ['nested']);
    const nestedArrow = nestedRow.locator('[data-testid="json-tree-arrow"]');
    await expect(nestedRow).toHaveAttribute('data-expanded', 'true');
    await expect(rowByPath(page, ['nested', 'a'])).toBeVisible();

    await nestedArrow.click();
    await expect(nestedRow).toHaveAttribute('data-expanded', 'false');
    await expect(nestedArrow).toHaveAttribute('aria-expanded', 'false');
    await expect(nestedArrow).toHaveAttribute('aria-label', 'Expand');
    await expect(rowByPath(page, ['nested', 'a'])).toHaveCount(0);
    await expect(rowByPath(page, ['nested', 'a', 'b', 'c'])).toHaveCount(0);
    await expect(closeRowByPath(page, ['nested'])).toHaveCount(0);
    await expect(nestedRow.locator('.json-tree-ellipsis')).toHaveCount(1);
    await expect(nestedRow.locator('[data-testid="json-tree-count"]')).toHaveText('1 item');
    // Collapsed nested is not the last child → still carries its comma.
    await expect(nestedRow.locator('.json-tree-comma')).toHaveCount(1);
    // 24 rows minus the 6 rows under nested (a open, b open, c leaf, close b, close a, close nested).
    await expect(tree(page)).toHaveAttribute('data-total-rows', '18');

    // `list` untouched.
    await expect(rowByPath(page, ['list'])).toHaveAttribute('data-expanded', 'true');
    await expect(rowByPath(page, ['list', 0])).toBeVisible();
    await expect(rowByPath(page, ['list', 2])).toBeVisible();
    await snap(page, 'FE-006', 'nested-collapsed');

    await nestedArrow.click();
    await expect(nestedRow).toHaveAttribute('data-expanded', 'true');
    await expect(nestedArrow).toHaveAttribute('aria-expanded', 'true');
    await expect(rowByPath(page, ['nested', 'a'])).toBeVisible();
    await expect(rowByPath(page, ['nested', 'a', 'b', 'c'])).toBeVisible();
    await expect(closeRowByPath(page, ['nested'])).toHaveCount(1);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');
    await snap(page, 'FE-006', 'nested-restored');

    // Part 2: large body — collapse records[0], scroll to the bottom and back, still collapsed.
    await sendUrl(page, `${fixture.baseUrl}/large.json`, 90000);
    await waitForTree(page, 60000);
    await waitForLargeTotalRows(page);
    const totalExpanded = await totalRows(page);

    const rec0 = rowByPath(page, ['records', 0]);
    await expect(rec0).toBeVisible();
    await expect(rec0).toHaveAttribute('data-expanded', 'true');
    await expect(rowByPath(page, ['records', 0, 'id'])).toBeVisible();

    await rec0.locator('[data-testid="json-tree-arrow"]').click();
    await expect(rec0).toHaveAttribute('data-expanded', 'false');
    await expect(rowByPath(page, ['records', 0, 'id'])).toHaveCount(0);
    await expect(rowByPath(page, ['records', 1])).toHaveAttribute('data-expanded', 'true');
    const totalAfterCollapse = await totalRows(page);
    expect(totalAfterCollapse).toBeLessThan(totalExpanded);
    expect(totalAfterCollapse).toBeGreaterThan(LARGE_MIN_ROWS);
    await snap(page, 'FE-006', 'records0-collapsed');

    const elapsed = await scrollToEndAndMeasure(page);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    await expect(page.locator('[data-testid="json-tree-row"][data-kind="close"][data-depth="0"]')).toBeVisible();
    // records[0] is unmounted while scrolled away — its state must live in React, not the DOM.
    await expect(rec0).toHaveCount(0);

    await scrollToTop(page, ['records', 0]);
    await expect(rec0).toHaveAttribute('data-expanded', 'false');
    await expect(rec0.locator('[data-testid="json-tree-arrow"]')).toHaveAttribute('aria-expanded', 'false');
    await expect(rowByPath(page, ['records', 0, 'id'])).toHaveCount(0);
    await expect(rowByPath(page, ['records', 1])).toHaveAttribute('data-expanded', 'true');
    expect(await totalRows(page)).toBe(totalAfterCollapse);
    await snap(page, 'FE-006', 'records0-still-collapsed');
  });

  // FE-007 — native cursor-selection copy of the whole wrapper yields the body as valid JSON.
  test('FE-007 selecting the whole tree and copying yields JSON equal to the body without badges', async ({ page }) => {
    await createTestRequest(page, uniqueName('VTree FE-007 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/types.json`);
    await waitForTree(page);

    const copied = await tree(page).evaluate(async (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      return await navigator.clipboard.readText();
    });

    expect(copied.trim().length).toBeGreaterThan(0);
    expect(() => JSON.parse(copied)).not.toThrow();
    expect(JSON.parse(copied)).toEqual(TYPES_FIXTURE);
    expect(copied).not.toMatch(/\d+\s+items?\b/);
    expect(copied).not.toContain('…');
    expect(JSON.parse(copied).long).toHaveLength(2000);
    await snap(page, 'FE-007', 'copied');
  });

  // FE-008 — per-node copy button copies nodeToJsonText(node).
  test('FE-008 hovering a row and clicking its copy control copies that node as pretty JSON', async ({ page }) => {
    await createTestRequest(page, uniqueName('VTree FE-008 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/types.json`);
    await waitForTree(page);

    const nestedRow = rowByPath(page, ['nested']);
    const copyBtn = nestedRow.locator('[data-testid="json-tree-copy"]');
    await expect(copyBtn).toHaveCount(1);
    await expect(copyBtn).toHaveAttribute('data-copied', 'false');
    await expect(copyBtn).toHaveText('');

    await nestedRow.hover();
    await copyBtn.click();
    await expect(copyBtn).toHaveAttribute('data-copied', 'true');
    // Windows normalizes clipboard text to CRLF on read-back; compare with LF.
    const copied = await readClipboardLf(page);
    expect(copied).toBe(JSON.stringify(TYPES_FIXTURE.nested, null, 2));
    await snap(page, 'FE-008', 'nested-copied');

    // The check state is transient (1500 ms).
    await expect(copyBtn).toHaveAttribute('data-copied', 'false', { timeout: 5000 });

    // A leaf copies its JSON token.
    const strRow = rowByPath(page, ['str']);
    await strRow.hover();
    await strRow.locator('[data-testid="json-tree-copy"]').click();
    await expect(strRow.locator('[data-testid="json-tree-copy"]')).toHaveAttribute('data-copied', 'true');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('"hello"');

    const intRow = rowByPath(page, ['int']);
    await intRow.hover();
    await intRow.locator('[data-testid="json-tree-copy"]').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('42');

    // The root copies the whole body.
    const rootRow = rowByPath(page, []);
    await rootRow.hover();
    await rootRow.locator('[data-testid="json-tree-copy"]').click();
    expect(await readClipboardLf(page)).toBe(JSON.stringify(TYPES_FIXTURE, null, 2));
    await snap(page, 'FE-008', 'root-copied');
  });

  // FE-009 — non-JSON bodies keep the plain <pre> path; no tree.
  test('FE-009 plain text response renders in the response-body pre and no tree', async ({ page }) => {
    await createTestRequest(page, uniqueName('VTree FE-009 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/plain.txt`);

    const pre = page.locator('.response-viewer pre.response-body');
    await expect(pre).toBeVisible({ timeout: 10000 });
    await expect(pre).toContainText(PLAIN_TEXT_FIXTURE);
    await expect(tree(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    await snap(page, 'FE-009', 'plain-text');
  });

  // FE-010 — Collapse all / Expand all / reset on a new response (deep.json).
  test('FE-010 collapse all hides deep text, expand all shows it, re-send resets to expanded', async ({ page }) => {
    await createTestRequest(page, uniqueName('VTree FE-010 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/deep.json`);
    await waitForTree(page);

    const deepText = 'WonderWidgets';
    await expect(tree(page).getByText(deepText, { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(rowByPath(page, ['slideshow', 'slides', 1, 'items', 0])).toBeVisible();

    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible();

    await dock.locator('[data-testid="response-collapse-all-btn"]').click();
    await expect(tree(page).getByText(deepText, { exact: false })).toHaveCount(0);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '1');
    await expect(rowByPath(page, [])).toHaveAttribute('data-expanded', 'false');
    await snap(page, 'FE-010', 'collapsed');

    await dock.locator('[data-testid="response-expand-all-btn"]').click();
    await expect(tree(page).getByText(deepText, { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(rowByPath(page, ['slideshow', 'slides', 1, 'items', 0])).toBeVisible();
    await snap(page, 'FE-010', 'expanded');

    // Collapse again, then re-send: the new response resets expansion to all-expanded.
    await dock.locator('[data-testid="response-collapse-all-btn"]').click();
    await expect(tree(page).getByText(deepText, { exact: false })).toHaveCount(0);

    await page.locator('.btn-send').click();
    await expect(page.locator('.response-viewer.loading')).not.toBeVisible({ timeout: 30000 });
    await waitForTree(page);
    await expect(tree(page).getByText(deepText, { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(rowByPath(page, ['slideshow']).locator('[data-testid="json-tree-key"]')).toHaveText('"slideshow"');
    await expect(rowByPath(page, [])).toHaveAttribute('data-expanded', 'true');
    await snap(page, 'FE-010', 'reset-after-resend');
  });

  // FE-011 — search after Collapse all force-expands ancestors and marks the hit.
  test('FE-011 search after collapse all force-expands to the match and highlights it', async ({ page }) => {
    await createTestRequest(page, uniqueName('VTree FE-011 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/deep.json`);
    await waitForTree(page);

    const deepText = 'WonderWidgets';
    const dock = page.locator('[data-testid="response-json-dock"]');
    await expect(dock).toBeVisible();

    await dock.locator('[data-testid="response-collapse-all-btn"]').click();
    await expect(tree(page).getByText(deepText, { exact: false })).toHaveCount(0);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '1');

    await dock.locator('[data-testid="response-search-btn"]').click();
    const input = page.locator('[data-testid="response-search-input"]');
    await expect(input).toBeFocused();
    await input.fill(deepText);

    await expect(marks(page).first()).toBeVisible({ timeout: 10000 });
    // The three occurrences live in slides[0].title, slides[1].items[0] and slides[1].items[1];
    // every one is inside a value span of a mounted row.
    await expect(marks(page)).toHaveCount(3);
    await expect(page.locator('[data-testid="json-tree-value"] mark.response-search-highlight[data-search-hit="true"]')).toHaveCount(3);
    await expect(page.locator('mark.response-search-highlight--active')).toHaveCount(1);
    await expect(rowByPath(page, ['slideshow', 'slides', 1, 'items', 0])).toBeVisible();
    await expect(rowByPath(page, ['slideshow', 'slides', 0, 'title'])).toBeVisible();
    expect(await totalRows(page)).toBeGreaterThan(1);
    await snap(page, 'FE-011', 'search-hit');
  });
});
