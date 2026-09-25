import { test, expect, Page } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';
import { startJsonFixtureServer } from './helpers/jsonFixtureServer';

// GH-72: tab persistence without re-serializing responses (FE-001..FE-003).
//
// Transport boundary: the fixture server lives in this Playwright worker process
// and is bound to http://127.0.0.1:<port>. The app classifies 127.0.0.1 as a
// local address, so its transport fetches the URL straight from the browser
// (window.fetch). Everything else is real: the real app at baseURL, the real
// local Supabase backend for collections/requests and the real localStorage.
// No page.route(). FE-001 wraps Storage.prototype.setItem in the page only to
// RECORD calls (key + value length) and then delegates to the original.

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

// The latency comparison in FE-001 must not compete with other tests of this
// file for CPU, so run them one after another in a single worker.
test.describe.configure({ mode: 'default' });

// --- Shared helpers (mirrored from the existing E2E suite's conventions) ---

const SIDEBAR_TIMEOUT = 15000;
const LARGE_TIMEOUT = 120000;
const LARGE_MIN_ROWS = 100000;
const ONE_MIB = 1024 * 1024;
const RESPONSE_KEY_PREFIX = 'openTabs:response:';

const tree = (page: Page) => page.locator('[data-testid="json-tree"]');
const rowByPath = (page: Page, path: (string | number)[]) =>
  page.locator(`[data-testid="json-tree-row"][data-path='${JSON.stringify(path)}']:not([data-kind="close"])`);
const tabs = (page: Page) => page.locator('.open-tab');
const errorBoundary = (page: Page) => page.locator('[data-testid="error-boundary-fallback"]');

async function waitForAppReady(page: Page) {
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
}

/**
 * Opens the collection's header menu and clicks "Add Request". The .btn-menu only
 * shows on hover and a realtime re-render can drop the hover mid-click, so the
 * hover + click + menu-visible sequence is retried as a unit.
 */
async function clickAddRequest(page: Page, collectionName: string) {
  const collectionHeader = page.locator('.collection-header').filter({ hasText: collectionName });
  await expect(collectionHeader).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
  const collectionMenu = page.locator('.collection-menu');
  await expect(async () => {
    if (!(await collectionMenu.isVisible())) {
      await collectionHeader.hover();
      await collectionHeader.locator('.btn-menu').click({ timeout: 2000 });
    }
    await expect(collectionMenu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
  await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();
}

/** Waits until `count` tabs are open, the last one is active and its request editor shows an empty URL. */
async function waitForNewRequestTab(page: Page, count: number) {
  await expect(tabs(page)).toHaveCount(count, { timeout: SIDEBAR_TIMEOUT });
  await expect(tabs(page).nth(count - 1)).toHaveClass(/\bactive\b/, { timeout: SIDEBAR_TIMEOUT });
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
  await expect(page.locator('.url-input')).toHaveValue('', { timeout: SIDEBAR_TIMEOUT });
}

/** Creates a collection plus its first request, which opens in tab #1. */
async function createTestRequest(page: Page, collectionName: string) {
  const addCollectionBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addCollectionBtn).toBeEnabled({ timeout: 10000 });
  await addCollectionBtn.click();

  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible({ timeout: 10000 });
  await promptModal.locator('.prompt-input').fill(collectionName);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();

  await clickAddRequest(page, collectionName);
  await expect(page.locator('.request-item').filter({ hasText: 'New Request' }).first()).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
  await waitForNewRequestTab(page, 1);
}

/** Adds another request to the collection; it opens in a new tab (#count). */
async function addRequestToCollection(page: Page, collectionName: string, count: number) {
  await clickAddRequest(page, collectionName);
  await waitForNewRequestTab(page, count);
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
  await expect(page.locator('.url-input')).toHaveValue(url);
  await sendRequestAndWaitForResponse(page, timeout);
}

async function waitForTree(page: Page, timeout = 10000) {
  await expect(tree(page)).toBeVisible({ timeout });
  await expect(tree(page)).toHaveAttribute('data-total-rows', /^\d+$/, { timeout });
}

async function waitForLargeTotalRows(page: Page, timeout = 60000) {
  await expect
    .poll(async () => Number(await tree(page).getAttribute('data-total-rows')), { timeout })
    .toBeGreaterThan(LARGE_MIN_ROWS);
}

/** Sends large.json in the active tab and waits until the body has fully arrived and rendered. */
async function sendLarge(page: Page) {
  await sendUrl(page, `${fixture.baseUrl}/large.json`, 90000);
  await waitForTree(page, 60000);
  await waitForLargeTotalRows(page);
  await expect(page.locator('.response-meta .status')).toContainText('200');
  await expect(errorBoundary(page)).toHaveCount(0);
}

/** Clicks tab #index in the tab bar and waits until it is the active one. */
async function activateTab(page: Page, index: number) {
  const tab = tabs(page).nth(index);
  await tab.click();
  await expect(tab).toHaveClass(/\bactive\b/, { timeout: 10000 });
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: 10000 });
}

// Screenshots land in test-results/screenshots/tab-persistence-<id>-<step>.png when
// PAPERPLANE_CAPTURE_SCREENSHOTS=1.
const CAPTURE = process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === '1';
async function snap(page: Page, id: string, step: string) {
  if (!CAPTURE) return;
  await page.screenshot({ path: `test-results/screenshots/tab-persistence-${id}-${step}.png` });
}

// --- FE-001 measurement helpers ---

const WARMUP_CHARS = 'ab';
const MEASURED_CHARS = 'cdefghijkl'; // 10 measured keystrokes
const MAX_LATENCY_DELTA_MS = 50;

/**
 * Waits for the page's main thread to drain the work queued by the last input:
 * a posted-message round trip (the same task source React's scheduler uses)
 * followed by a timer tick.
 */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => setTimeout(() => resolve(), 0);
        channel.port2.postMessage(0);
      }),
  );
}

/**
 * Types WARMUP_CHARS (unmeasured) then MEASURED_CHARS into the active tab's URL
 * input, timing each measured keystroke individually from Node (key dispatch +
 * the page settling). Returns the per-keystroke times in ms.
 */
async function typeAndMeasure(page: Page): Promise<number[]> {
  const input = page.locator('.url-input');
  await input.click();
  await page.keyboard.press('End');
  for (const ch of WARMUP_CHARS) {
    await page.keyboard.type(ch);
    await settle(page);
  }
  const times: number[] = [];
  for (const ch of MEASURED_CHARS) {
    const start = Date.now();
    await page.keyboard.type(ch);
    await settle(page);
    times.push(Date.now() - start);
  }
  return times;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type RecordedWrite = { key: string; length: number };

/** Instrumentation only: records every Storage#setItem (key + value length) and delegates to the original. */
async function installSetItemRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __gh72OriginalSetItem?: Storage['setItem'];
      __gh72Writes?: { key: string; length: number }[];
    };
    if (!w.__gh72OriginalSetItem) w.__gh72OriginalSetItem = Storage.prototype.setItem;
    const original = w.__gh72OriginalSetItem;
    w.__gh72Writes = [];
    Storage.prototype.setItem = function recordedSetItem(this: Storage, key: string, value: string) {
      w.__gh72Writes!.push({ key: String(key), length: String(value).length });
      return original.call(this, key, value);
    };
  });
}

/** Returns the recorded writes and restores the original Storage#setItem. */
async function collectSetItemWrites(page: Page): Promise<RecordedWrite[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __gh72OriginalSetItem?: Storage['setItem'];
      __gh72Writes?: { key: string; length: number }[];
    };
    if (w.__gh72OriginalSetItem) Storage.prototype.setItem = w.__gh72OriginalSetItem;
    return w.__gh72Writes ?? [];
  });
}

// --- FE-003 storage inspection helpers (read-only) ---

type PersistedTabSummary = { id: string; url: string | null; hasResponse: boolean };
type StoredResponseSummary = { length: number; parsesToObject: boolean };
type PersistenceSnapshot = {
  /** Length of the raw `openTabs` value, or -1 when the key is missing. */
  metaLength: number;
  /** One summary per parsed `openTabs` entry, or null when the key is missing or unparseable. */
  tabs: PersistedTabSummary[] | null;
  /** Per requested tab id: null when `openTabs:response:<id>` is absent. */
  responses: Record<string, StoredResponseSummary | null>;
};

/**
 * Reads the persisted tab state from the page's localStorage. Values are
 * summarized in the page (a response key reports its length, not its body).
 */
async function readPersistence(page: Page, tabIds: string[] = []): Promise<PersistenceSnapshot> {
  return page.evaluate(
    ({ ids, prefix }) => {
      const raw = localStorage.getItem('openTabs');
      let tabs: { id: string; url: string | null; hasResponse: boolean }[] | null = null;
      try {
        const parsed = raw == null ? null : JSON.parse(raw);
        if (Array.isArray(parsed)) {
          tabs = parsed
            .filter((t) => t !== null && typeof t === 'object')
            .map((t) => ({
              id: String(t.id),
              url: typeof t.request?.url === 'string' ? t.request.url : null,
              hasResponse: Object.prototype.hasOwnProperty.call(t, 'response'),
            }));
        }
      } catch {
        tabs = null;
      }
      const responses: Record<string, { length: number; parsesToObject: boolean } | null> = {};
      for (const id of ids) {
        const value = localStorage.getItem(prefix + id);
        if (value == null) {
          responses[id] = null;
          continue;
        }
        let parsesToObject = false;
        try {
          const parsedValue = JSON.parse(value);
          parsesToObject = parsedValue !== null && typeof parsedValue === 'object';
        } catch {
          parsesToObject = false;
        }
        responses[id] = { length: value.length, parsesToObject };
      }
      return { metaLength: raw == null ? -1 : raw.length, tabs, responses };
    },
    { ids: tabIds, prefix: RESPONSE_KEY_PREFIX },
  );
}

/** Waits until the persisted `openTabs` metadata lists a tab whose request URL is `url`; returns its id. */
async function persistedTabIdForUrl(page: Page, url: string): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        const { tabs: persisted } = await readPersistence(page);
        id = persisted?.find((t) => t.url === url)?.id ?? '';
        return id;
      },
      { timeout: 15000, message: `"openTabs" must list the tab whose URL is ${url}` },
    )
    .not.toBe('');
  return id;
}

test.describe('Tab persistence without re-serializing responses (GH-72)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  // FE-001 (AC-1, AC-2, regression): with three 10 MiB responses open, the median
  // per-keystroke latency of typing in a fourth tab's URL stays within 50 ms of the
  // median with no responses loaded, and no response is written.
  test('FE-001 typing in a fourth tab stays as fast as with no responses and never re-writes response bodies', async ({ page }) => {
    // On the unfixed code every keystroke re-serializes ~30 MB several times, so
    // allow the red run to reach its assertions instead of timing out.
    test.setTimeout(600000);
    const collectionName = uniqueName('TabPersist FE-001 Collection');

    // Baseline: tab #1, no response loaded anywhere.
    await createTestRequest(page, collectionName);
    await expect(page.locator('.response-meta')).toHaveCount(0);
    const baselineTimes = await typeAndMeasure(page);
    await expect(page.locator('.url-input')).toHaveValue(WARMUP_CHARS + MEASURED_CHARS);
    await snap(page, 'FE-001', 'baseline-typed');

    // Three request tabs each holding the >= 10 MiB body.
    await sendLarge(page);
    await addRequestToCollection(page, collectionName, 2);
    await sendLarge(page);
    await addRequestToCollection(page, collectionName, 3);
    await sendLarge(page);
    await snap(page, 'FE-001', 'three-large-responses');

    // Fourth request tab.
    await addRequestToCollection(page, collectionName, 4);
    await expect(page.locator('.response-meta')).toHaveCount(0);
    await expect(errorBoundary(page)).toHaveCount(0);
    await settle(page);

    await installSetItemRecorder(page);
    const loadedTimes = await typeAndMeasure(page);
    await expect(page.locator('.url-input')).toHaveValue(WARMUP_CHARS + MEASURED_CHARS);
    // Let any deferred persistence land before reading the recorder.
    await page.waitForTimeout(500);
    const writes = await collectSetItemWrites(page);
    await snap(page, 'FE-001', 'fourth-tab-typed');

    const baselineMedian = median(baselineTimes);
    const loadedMedian = median(loadedTimes);
    const openTabsWrites = writes.filter((w) => w.key === 'openTabs');
    const responseKeyWrites = writes.filter((w) => w.key.startsWith(RESPONSE_KEY_PREFIX));
    const largestOpenTabsWrite = openTabsWrites.reduce((max, w) => Math.max(max, w.length), 0);
    const metrics = {
      baselineTimes,
      loadedTimes,
      baselineMedian,
      loadedMedian,
      deltaMs: loadedMedian - baselineMedian,
      openTabsWriteCount: openTabsWrites.length,
      openTabsWriteLengths: openTabsWrites.map((w) => w.length),
      largestOpenTabsWrite,
      responseKeyWrites,
      writeKeys: Array.from(new Set(writes.map((w) => w.key))),
    };
    console.log(`[FE-001 metrics] ${JSON.stringify(metrics)}`);
    test.info().annotations.push({ type: 'FE-001 metrics', description: JSON.stringify(metrics) });

    // The recorder saw the persistence writes (sanity check of the instrumentation).
    expect(openTabsWrites.length, 'typing must still persist the open tabs metadata').toBeGreaterThan(0);

    // AC-1: per-keystroke latency within 50 ms of the no-response baseline (medians).
    expect
      .soft(
        loadedMedian - baselineMedian,
        `median keystroke latency with three 10 MiB responses (${loadedMedian} ms) vs baseline (${baselineMedian} ms)`,
      )
      .toBeLessThanOrEqual(MAX_LATENCY_DELTA_MS);
    // AC-2: typing never writes a response key ...
    expect.soft(responseKeyWrites, 'no openTabs:response:* key may be written while typing').toEqual([]);
    // ... and no metadata write carries a response body.
    expect
      .soft(largestOpenTabsWrite, `largest "openTabs" write while typing was ${largestOpenTabsWrite} chars`)
      .toBeLessThan(ONE_MIB);

    await expect(errorBoundary(page)).toHaveCount(0);
  });

  // FE-002 (AC-3): open tabs and their last responses restore after a reload.
  test('FE-002 open tabs and their last responses restore after a reload without re-sending', async ({ page }) => {
    test.setTimeout(180000);
    const collectionName = uniqueName('TabPersist FE-002 Collection');
    const typesUrl = `${fixture.baseUrl}/types.json`;
    const deepUrl = `${fixture.baseUrl}/deep.json`;

    await createTestRequest(page, collectionName);
    await sendUrl(page, typesUrl);
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');

    await addRequestToCollection(page, collectionName, 2);
    await sendUrl(page, deepUrl);
    await waitForTree(page);
    await expect(rowByPath(page, ['slideshow'])).toBeVisible();
    await snap(page, 'FE-002', 'before-reload');

    await page.reload();
    await waitForAppReady(page);

    await expect(tabs(page)).toHaveCount(2, { timeout: SIDEBAR_TIMEOUT });

    // Tab #2 (deep.json) — its restored response is shown.
    await activateTab(page, 1);
    await expect(page.locator('.url-input')).toHaveValue(deepUrl);
    await expect(page.locator('.response-meta')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.response-meta .status')).toContainText('200');
    await waitForTree(page);
    await expect(rowByPath(page, ['slideshow']).locator('[data-testid="json-tree-key"]')).toHaveText('"slideshow"');
    await expect(tree(page).getByText('Sample Slide Show', { exact: false }).first()).toBeVisible();
    await snap(page, 'FE-002', 'after-reload-tab2');

    // Tab #1 (types.json) — its restored response is shown.
    await activateTab(page, 0);
    await expect(page.locator('.url-input')).toHaveValue(typesUrl);
    await expect(page.locator('.response-meta')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.response-meta .status')).toContainText('200');
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');
    await expect(rowByPath(page, ['str']).locator('[data-testid="json-tree-value"]')).toHaveText('"hello"');
    await snap(page, 'FE-002', 'after-reload-tab1');

    // Restored, not re-sent: the fixture server was not fetched since the reload.
    const fixtureFetches = await page.evaluate(
      (base) => performance.getEntriesByType('resource').filter((e) => e.name.startsWith(base)).map((e) => e.name),
      fixture.baseUrl,
    );
    expect(fixtureFetches).toEqual([]);
    await expect(errorBoundary(page)).toHaveCount(0);
  });

  // FE-003 (AC-4): an over-quota response neither crashes nor blocks the app, and
  // the other tab and its response still persist.
  test('FE-003 an over-quota response keeps the app usable and the other tab and response still persist', async ({ page }) => {
    test.setTimeout(300000);
    const storageErrors: string[] = [];
    page.on('pageerror', (err) => {
      if (/quota|setItem|localStorage/i.test(`${err.name} ${err.message}`)) storageErrors.push(`${err.name}: ${err.message}`);
    });

    const collectionName = uniqueName('TabPersist FE-003 Collection');
    const largeUrl = `${fixture.baseUrl}/large.json`;
    const typesUrl = `${fixture.baseUrl}/types.json`;

    // Tab #1: the >= 10 MiB body (exceeds Chromium's localStorage quota).
    await createTestRequest(page, collectionName);
    await sendLarge(page);
    await snap(page, 'FE-003', 'tab1-large');
    const largeTabId = await persistedTabIdForUrl(page, largeUrl);

    // Tab #2: the small body.
    await addRequestToCollection(page, collectionName, 2);
    await sendUrl(page, typesUrl);
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');
    await expect(errorBoundary(page)).toHaveCount(0);
    const smallTabId = await persistedTabIdForUrl(page, typesUrl);
    expect(smallTabId).not.toBe(largeTabId);

    // The small response lands under its own key (the write may follow the render).
    await expect
      .poll(async () => (await readPersistence(page, [smallTabId])).responses[smallTabId], {
        timeout: 15000,
        message: `"${RESPONSE_KEY_PREFIX}${smallTabId}" must hold the types.json response`,
      })
      .toEqual(expect.objectContaining({ parsesToObject: true }));

    // The over-quota path ran: the persist that stored the small response also went
    // over the large tab (its response was already in the tab state), yet the large
    // tab's response key is absent while the metadata still lists that tab, and no
    // metadata entry carries a response body.
    const beforeReload = await readPersistence(page, [largeTabId, smallTabId]);
    console.log(`[FE-003 storage before reload] ${JSON.stringify(beforeReload)}`);
    expect(beforeReload.responses[largeTabId], `"${RESPONSE_KEY_PREFIX}${largeTabId}" must be absent (over quota)`).toBeNull();
    expect(beforeReload.responses[smallTabId]).not.toBeNull();
    expect(beforeReload.tabs, '"openTabs" must be present and parseable').not.toBeNull();
    const persistedIds = (beforeReload.tabs ?? []).map((t) => t.id);
    expect(persistedIds).toContain(largeTabId);
    expect(persistedIds).toContain(smallTabId);
    expect((beforeReload.tabs ?? []).filter((t) => t.hasResponse).map((t) => t.id)).toEqual([]);
    expect(beforeReload.metaLength).toBeGreaterThan(0);
    expect(beforeReload.metaLength).toBeLessThan(ONE_MIB);

    // Switching and typing work in the large tab.
    await activateTab(page, 0);
    await waitForTree(page, 30000);
    await waitForLargeTotalRows(page, 30000);
    const urlInput = page.locator('.url-input');
    await urlInput.click();
    await page.keyboard.press('End');
    await page.keyboard.type('?a=1');
    await expect(urlInput).toHaveValue(`${largeUrl}?a=1`);
    await expect(errorBoundary(page)).toHaveCount(0);

    // Switching back, typing and sending work in the small tab.
    await activateTab(page, 1);
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');
    await urlInput.click();
    await page.keyboard.press('End');
    await page.keyboard.type('?b=2');
    await expect(urlInput).toHaveValue(`${typesUrl}?b=2`);
    await sendRequestAndWaitForResponse(page);
    await expect(page.locator('.response-meta .status')).toContainText('200');
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');
    await expect(errorBoundary(page)).toHaveCount(0);
    await snap(page, 'FE-003', 'usable-after-over-quota');

    await page.reload();
    await waitForAppReady(page);
    await expect(errorBoundary(page)).toHaveCount(0);

    // Both tabs are present.
    await expect(tabs(page)).toHaveCount(2, { timeout: SIDEBAR_TIMEOUT });

    // The small response is restored (with the tab's edited URL).
    await activateTab(page, 1);
    await expect(page.locator('.url-input')).toHaveValue(`${typesUrl}?b=2`);
    await expect(page.locator('.response-meta')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.response-meta .status')).toContainText('200');
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');
    await expect(rowByPath(page, ['str']).locator('[data-testid="json-tree-value"]')).toHaveText('"hello"');
    await snap(page, 'FE-003', 'after-reload-small-restored');

    // The large tab is present and usable (dropping its body from persistence is acceptable).
    await activateTab(page, 0);
    await expect(page.locator('.url-input')).toHaveValue(`${largeUrl}?a=1`);
    await expect(errorBoundary(page)).toHaveCount(0);
    await snap(page, 'FE-003', 'after-reload-large-tab');

    expect(storageErrors).toEqual([]);
  });
});
