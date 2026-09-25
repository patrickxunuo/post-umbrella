import { test, expect, Page, Locator } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';
import {
  startJsonFixtureServer,
  buildLargeFixture,
  DEEP_FIXTURE,
  PLAIN_TEXT_FIXTURE,
  type LargeRecord,
} from './helpers/jsonFixtureServer';

// GH-71: response search on the row-virtualized JSON tree (FE-101..FE-109).
//
// Transport boundary: the fixture server lives in this Playwright worker process
// and is bound to http://127.0.0.1:<port>. The app classifies 127.0.0.1 as a
// local address, so its transport fetches the URL straight from the browser
// (window.fetch) — the Supabase proxy Edge Function is never involved. Every
// other part of the stack is real: the real app at baseURL and the real Supabase
// backend for auth, collections and requests. No page.route().
//
// Timings are measured inside the page (event.timeStamp / performance.now()),
// polled once per animation frame, so Playwright round-trips only ever make a
// measurement longer, never shorter.

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

// --- Shared helpers (mirrored from the GH-70 virtualized-tree spec) ---

const SIDEBAR_TIMEOUT = 15000;

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
  // The menu button only shows on hover, and a realtime sidebar re-render can
  // drop the hover state mid-click; retry hover + click until the menu opens.
  const collectionMenu = page.locator('.collection-menu');
  await expect(async () => {
    await collectionHeader.hover();
    await collectionHeader.locator('.btn-menu').click({ timeout: 2000 });
    await expect(collectionMenu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: SIDEBAR_TIMEOUT });
  await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

  const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
  await expect(requestItem).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
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

const LARGE_MIN_ROWS = 100000;
const LARGE_TIMEOUT = 150000;
// Contract constant SEARCH_MATCH_CAP (src/utils/jsonSearch.js).
const SEARCH_MATCH_CAP = 5000;

const tree = (page: Page) => page.locator('[data-testid="json-tree"]');
// A container's open row and its close row share the same data-path (node.id);
// rowByPath targets the open/leaf/empty row.
const rowByPath = (page: Page, path: (string | number)[]) =>
  page.locator(`[data-testid="json-tree-row"][data-path='${JSON.stringify(path)}']:not([data-kind="close"])`);
const marks = (page: Page) => page.locator('mark.response-search-highlight[data-search-hit="true"]');
const activeMarks = (page: Page) => page.locator('mark.response-search-highlight--active');
const valueMarks = (row: Locator) =>
  row.locator('[data-testid="json-tree-value"] mark.response-search-highlight[data-search-hit="true"]');
const dock = (page: Page) => page.locator('[data-testid="response-json-dock"]');
const searchInput = (page: Page) => page.locator('[data-testid="response-search-input"]');
const searchCount = (page: Page) => page.locator('[data-testid="response-search-count"]');

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

async function loadLarge(page: Page, collection: string) {
  await createTestRequest(page, uniqueName(collection));
  await sendUrl(page, `${fixture.baseUrl}/large.json`, 90000);
  await waitForTree(page, 60000);
  await waitForLargeTotalRows(page);
  await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
}

async function openSearch(page: Page): Promise<Locator> {
  await expect(dock(page)).toBeVisible();
  await dock(page).locator('[data-testid="response-search-btn"]').click();
  const input = searchInput(page);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  return input;
}

/**
 * True when exactly one active mark exists and its box intersects the box of the
 * tree's scroll container (its visible viewport). toBeVisible() alone would not
 * notice a mark scrolled out of the container.
 */
async function activeMarkInViewport(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const treeEl = document.querySelector('[data-testid="json-tree"]');
    const active = document.querySelectorAll('mark.response-search-highlight--active');
    if (!treeEl || active.length !== 1) return false;
    const t = treeEl.getBoundingClientRect();
    const m = active[0].getBoundingClientRect();
    if (m.width <= 0 || m.height <= 0) return false;
    return m.top < t.bottom && m.bottom > t.top && m.left < t.right && m.right > t.left;
  });
}

/** Records event.timeStamp of printable keydowns and input events on the search input. */
async function installSearchClock(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __searchClock?: Record<string, number> };
    if (w.__searchClock) return;
    const clock = { keys: 0, lastKeyAt: 0, inputs: 0, lastInputAt: 0 };
    w.__searchClock = clock;
    const isSearchInput = (target: EventTarget | null) =>
      (target as HTMLElement | null)?.getAttribute?.('data-testid') === 'response-search-input';
    window.addEventListener('keydown', (e) => {
      if (!isSearchInput(e.target)) return;
      if (typeof e.key !== 'string' || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      clock.keys += 1;
      clock.lastKeyAt = e.timeStamp;
    }, true);
    window.addEventListener('input', (e) => {
      if (!isSearchInput(e.target)) return;
      clock.inputs += 1;
      clock.lastInputAt = e.timeStamp;
    }, true);
  });
}

type LongTask = { startTime: number; duration: number };

async function installLongTaskRecorder(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as { __longTasks?: LongTask[]; __longTaskObserver?: PerformanceObserver };
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return false;
    w.__longTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks!.push({ startTime: e.startTime, duration: e.duration });
    });
    observer.observe({ type: 'longtask', buffered: true });
    w.__longTaskObserver = observer;
    return true;
  });
}

async function readLongTasks(page: Page): Promise<LongTask[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __longTasks: LongTask[]; __longTaskObserver: PerformanceObserver };
    for (const e of w.__longTaskObserver.takeRecords()) w.__longTasks.push({ startTime: e.startTime, duration: e.duration });
    return w.__longTasks.slice();
  });
}

/** Records defaultPrevented of every Ctrl/Cmd+F keydown reaching window (bubble phase). */
async function installFindKeyRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __findKeys?: boolean[] };
    w.__findKeys = [];
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && typeof e.key === 'string' && e.key.toLowerCase() === 'f') {
        w.__findKeys!.push(e.defaultPrevented);
      }
    });
  });
}

const findKeyLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __findKeys?: boolean[] }).__findKeys ?? []);

const focusInsideViewer = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('.response-viewer'));

// Screenshots land in test-results/screenshots/json-search-<id>-<step>.png when
// PAPERPLANE_CAPTURE_SCREENSHOTS=1.
const CAPTURE = process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === '1';
async function snap(page: Page, id: string, step: string) {
  if (!CAPTURE) return;
  await page.screenshot({ path: `test-results/screenshots/json-search-${id}-${step}.png` });
}

// --- Test oracle for the contract's match semantics (B2/B3) ---
// Preorder over the body; a node's key text (object keys only) before its value
// text (leaves only); case-insensitive, non-overlapping; capped at SEARCH_MATCH_CAP.

type Match = { id: string; kind: 'key' | 'value'; ordinal: number };
type SearchText = { path: (string | number)[]; kind: 'key' | 'value'; lower: string };

function collectSearchTexts(root: unknown): SearchText[] {
  const out: SearchText[] = [];
  const stack: { value: unknown; path: (string | number)[]; keyed: boolean }[] = [
    { value: root, path: [], keyed: false },
  ];
  while (stack.length > 0) {
    const { value, path, keyed } = stack.pop()!;
    if (keyed) out.push({ path, kind: 'key', lower: String(path[path.length - 1]).toLowerCase() });
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], path: [...path, i], keyed: false });
    } else if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      for (let i = keys.length - 1; i >= 0; i--) stack.push({ value: obj[keys[i]], path: [...path, keys[i]], keyed: true });
    } else {
      out.push({ path, kind: 'value', lower: (value === null ? 'null' : String(value)).toLowerCase() });
    }
  }
  return out;
}

function oracleMatches(texts: SearchText[], query: string, cap = SEARCH_MATCH_CAP): Match[] {
  const q = query.toLowerCase();
  const out: Match[] = [];
  if (!q) return out;
  for (const t of texts) {
    let from = 0;
    let ordinal = 0;
    let idx: number;
    while ((idx = t.lower.indexOf(q, from)) !== -1) {
      out.push({ id: JSON.stringify(t.path), kind: t.kind, ordinal: ordinal++ });
      if (out.length >= cap) return out;
      from = idx + q.length;
    }
  }
  return out;
}

const counterFor = (n: number, active = 1) =>
  n === 0 ? '0 / 0' : `${active} / ${n}${n >= SEARCH_MATCH_CAP ? '+' : ''}`;

/** Rows of a fully expanded tree: one per node plus one close row per non-empty container. */
function expandedRowCount(root: unknown): number {
  let count = 0;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    count += 1;
    if (value !== null && typeof value === 'object') {
      const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
      if (children.length > 0) count += 1;
      for (const child of children) stack.push(child);
    }
  }
  return count;
}

let largeOracleCache: { records: LargeRecord[]; lastIndex: number; texts: SearchText[] } | null = null;
function largeOracle() {
  if (!largeOracleCache) {
    const body = buildLargeFixture();
    largeOracleCache = {
      records: body.records,
      lastIndex: body.records.length - 1,
      texts: collectSearchTexts(body),
    };
  }
  return largeOracleCache;
}

const DEEP_TEXT = 'WonderWidgets';
const DEEP_TOTAL_ROWS = expandedRowCount(DEEP_FIXTURE);

test.describe('Response viewer — search on the virtualized JSON tree (GH-71)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  // FE-101 — Ctrl+F inside the viewer: native find prevented, bar opens focused; Escape closes; reopen is empty.
  test('FE-101 Ctrl+F inside the viewer opens the bar focused with the keydown defaultPrevented; Escape closes; reopening starts empty', async ({ page }) => {
    await createTestRequest(page, uniqueName('Search FE-101 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/types.json`);
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', '24');
    await expect(searchInput(page)).toHaveCount(0);

    await installFindKeyRecorder(page);

    // Click a mounted row's key text (not a button) to put focus inside the viewer.
    const strKey = rowByPath(page, ['str']).locator('[data-testid="json-tree-key"]');
    await expect(strKey).toBeVisible();
    await strKey.click();
    await expect.poll(() => focusInsideViewer(page)).toBe(true);

    await page.keyboard.press('Control+f');

    const input = searchInput(page);
    await expect(input).toBeVisible({ timeout: 5000 });
    await expect(input).toBeFocused();
    await expect.poll(() => findKeyLog(page)).toEqual([true]);
    await snap(page, 'FE-101', 'bar-open');

    await input.fill('hello');
    await expect(searchCount(page)).toHaveText('1 / 1');
    await expect(marks(page)).toHaveCount(1);
    await expect(activeMarks(page)).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(marks(page)).toHaveCount(0);
    await expect(dock(page).locator('[data-testid="response-search-btn"]')).toBeVisible();
    await snap(page, 'FE-101', 'closed');

    // Reopen via the magnifier: the query and the active index were cleared.
    await dock(page).locator('[data-testid="response-search-btn"]').click();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await expect(searchCount(page)).toHaveText('');
    await expect(marks(page)).toHaveCount(0);
    await expect(activeMarks(page)).toHaveCount(0);
    await snap(page, 'FE-101', 'reopened-empty');
  });

  // FE-102 — typing char by char on the 10 MB body stays responsive.
  test('FE-102 typing a query char by char on large.json reflects every keystroke within 1 s without long main-thread tasks', async ({ page }) => {
    test.setTimeout(240000);
    const { texts, lastIndex } = largeOracle();
    const query = `Record ${lastIndex} lorem`;
    const targetPath = ['records', lastIndex, 'name'];
    const targetId = JSON.stringify(targetPath);

    // The full query matches exactly one leaf: the last record's name.
    expect(oracleMatches(texts, query)).toEqual([{ id: targetId, kind: 'value', ordinal: 0 }]);
    const steps = [...query].map((ch, i) => {
      const prefix = query.slice(0, i + 1);
      return { ch, prefix, counter: counterFor(oracleMatches(texts, prefix).length) };
    });
    expect(steps[steps.length - 1].counter).toBe('1 / 1');
    // Every prefix matches something, so every keystroke has an active mark to observe.
    steps.forEach((s) => expect(s.counter, s.prefix).not.toBe('0 / 0'));

    await loadLarge(page, 'Search FE-102 Collection');
    await snap(page, 'FE-102', 'loaded');

    await openSearch(page);
    await installSearchClock(page);
    expect(await installLongTaskRecorder(page), 'longtask entries must be observable').toBe(true);

    // A keystroke is reflected once the counter shows the oracle's value for the new
    // prefix AND the single active mark's text is that prefix (the counter alone can
    // repeat between prefixes, e.g. "1 / 5000+" or "1 / 1").
    const timings: { prefix: string; ms: number }[] = [];
    let typingStartAt = -1;
    let firstUpdateAt = -1;
    for (const [i, step] of steps.entries()) {
      await page.keyboard.type(step.ch);
      const handle = await page.waitForFunction(
        ({ counter, prefix, keys }) => {
          const clock = (window as unknown as { __searchClock?: Record<string, number> }).__searchClock;
          if (!clock || clock.keys < keys) return false;
          const text = (document.querySelector('[data-testid="response-search-count"]')?.textContent ?? '').trim();
          if (text !== counter) return false;
          const active = document.querySelectorAll('mark.response-search-highlight--active');
          if (active.length !== 1) return false;
          if ((active[0].textContent ?? '').toLowerCase() !== prefix.toLowerCase()) return false;
          const now = performance.now();
          return { ms: now - clock.lastKeyAt, at: now, keyAt: clock.lastKeyAt };
        },
        { counter: step.counter, prefix: step.prefix, keys: i + 1 },
        { polling: 'raf', timeout: 15000 },
      );
      const { ms, at, keyAt } = (await handle.jsonValue()) as { ms: number; at: number; keyAt: number };
      if (i === 0) {
        typingStartAt = keyAt;
        firstUpdateAt = at;
      }
      timings.push({ prefix: step.prefix, ms: Math.round(ms) });
    }

    const report = JSON.stringify(timings);
    for (const t of timings) {
      expect(t.ms, `keystroke "${t.prefix}" took ${t.ms} ms; all: ${report}`).toBeLessThanOrEqual(1000);
    }

    await expect(searchCount(page)).toHaveText('1 / 1');
    await expect(searchInput(page)).toHaveValue(query);
    const targetRow = rowByPath(page, targetPath);
    await expect(targetRow.locator('mark.response-search-highlight--active')).toHaveCount(1);
    await expect(targetRow.locator('mark.response-search-highlight--active')).toHaveText(query);
    await expect.poll(() => activeMarkInViewport(page), { timeout: 5000 }).toBe(true);
    await snap(page, 'FE-102', 'typed');

    // Let the observer deliver the last entries, then check the main thread.
    await page.waitForTimeout(500);
    const longTasks = await readLongTasks(page);
    const duringTyping = longTasks.filter((t) => t.startTime + t.duration > typingStartAt);
    const tooLong = duringTyping.filter((t) => t.duration > 1000);
    expect(tooLong, `long tasks > 1000 ms during typing: ${JSON.stringify(duringTyping)}`).toEqual([]);
    const afterFirst = longTasks.filter((t) => t.startTime >= firstUpdateAt);
    const tooLongLater = afterFirst.filter((t) => t.duration > 300);
    expect(tooLongLater, `long tasks > 300 ms after the first keystroke: ${JSON.stringify(afterFirst)}; keystrokes: ${report}`)
      .toEqual([]);
  });

  // FE-103 — search from a fully collapsed large tree expands the hit's ancestors within 1 s.
  test('FE-103 after Collapse all, searching a value of the last record expands its ancestors and shows the hit within 1 s', async ({ page }) => {
    test.setTimeout(LARGE_TIMEOUT);
    const { texts, records, lastIndex } = largeOracle();
    const uuid = records[lastIndex].uuid;
    const targetPath = ['records', lastIndex, 'uuid'];
    expect(oracleMatches(texts, uuid)).toEqual([{ id: JSON.stringify(targetPath), kind: 'value', ordinal: 0 }]);

    await loadLarge(page, 'Search FE-103 Collection');

    await dock(page).locator('[data-testid="response-collapse-all-btn"]').click();
    await expect(tree(page)).toHaveAttribute('data-total-rows', '1');
    await expect(rowByPath(page, [])).toHaveAttribute('data-expanded', 'false');
    await snap(page, 'FE-103', 'collapsed');

    const input = await openSearch(page);
    await installSearchClock(page);
    await input.fill(uuid);

    // Timed from the input event until the counter, the record's open row and the
    // on-screen active mark all reflect the hit.
    const handle = await page.waitForFunction(
      ({ recordPath }) => {
        const clock = (window as unknown as { __searchClock?: Record<string, number> }).__searchClock;
        if (!clock || clock.inputs < 1) return false;
        const text = (document.querySelector('[data-testid="response-search-count"]')?.textContent ?? '').trim();
        if (text !== '1 / 1') return false;
        const recordRow = document.querySelector(
          `[data-testid="json-tree-row"][data-path='${recordPath}']:not([data-kind="close"])`,
        );
        if (!recordRow || recordRow.getAttribute('data-expanded') !== 'true') return false;
        const treeEl = document.querySelector('[data-testid="json-tree"]');
        const active = document.querySelectorAll('mark.response-search-highlight--active');
        if (!treeEl || active.length !== 1) return false;
        const t = treeEl.getBoundingClientRect();
        const m = active[0].getBoundingClientRect();
        if (m.height <= 0 || m.bottom <= t.top || m.top >= t.bottom) return false;
        return { ms: performance.now() - clock.lastInputAt };
      },
      { recordPath: JSON.stringify(['records', lastIndex]) },
      { polling: 'raf', timeout: 15000 },
    );
    const { ms } = (await handle.jsonValue()) as { ms: number };
    expect(ms, `search from collapsed took ${Math.round(ms)} ms`).toBeLessThanOrEqual(1000);

    await expect(searchCount(page)).toHaveText('1 / 1');
    await expect(rowByPath(page, ['records', lastIndex])).toHaveAttribute('data-expanded', 'true');
    const targetRow = rowByPath(page, targetPath);
    await expect(targetRow.locator('mark.response-search-highlight--active')).toHaveCount(1);
    await expect(targetRow.locator('mark.response-search-highlight--active')).toHaveText(uuid);
    await expect.poll(() => activeMarkInViewport(page), { timeout: 5000 }).toBe(true);
    // ["records"] is expanded too: the whole body is back in the row list.
    expect(await totalRows(page)).toBeGreaterThan(LARGE_MIN_ROWS);
    await snap(page, 'FE-103', 'hit');

    // The ["records"] open row sits at the top of the list; scroll there to check it directly.
    await tree(page).evaluate((el) => { el.scrollTop = 0; });
    await expect(rowByPath(page, ['records'])).toHaveAttribute('data-expanded', 'true', { timeout: 10000 });
    await expect(rowByPath(page, [])).toHaveAttribute('data-expanded', 'true');
    await snap(page, 'FE-103', 'ancestors-top');
  });

  // FE-104 — a hit far below the viewport is mounted and scrolled into view.
  test('FE-104 from scrollTop 0 a hit in the last record mounts its row and brings the active mark into the viewport', async ({ page }) => {
    test.setTimeout(LARGE_TIMEOUT);
    const { texts, lastIndex } = largeOracle();
    const query = `Record ${lastIndex} lorem`;
    const targetPath = ['records', lastIndex, 'name'];
    expect(oracleMatches(texts, query)).toEqual([{ id: JSON.stringify(targetPath), kind: 'value', ordinal: 0 }]);

    await loadLarge(page, 'Search FE-104 Collection');

    await expect.poll(() => tree(page).evaluate((el) => el.scrollTop)).toBe(0);
    const targetRow = rowByPath(page, targetPath);
    await expect(targetRow).toHaveCount(0);
    await expect(rowByPath(page, [])).toBeVisible();
    await snap(page, 'FE-104', 'top');

    const input = await openSearch(page);
    await input.fill(query);

    await expect(searchCount(page)).toHaveText('1 / 1', { timeout: 10000 });
    await expect(targetRow).toHaveCount(1, { timeout: 10000 });
    await expect(targetRow.locator('mark.response-search-highlight--active')).toHaveCount(1);
    await expect(targetRow.locator('mark.response-search-highlight--active')).toHaveText(query);
    await expect(activeMarks(page)).toHaveCount(1);
    await expect.poll(() => activeMarkInViewport(page), { timeout: 5000 }).toBe(true);
    expect(await tree(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // The top of the list is no longer mounted.
    await expect(rowByPath(page, [])).toHaveCount(0);
    await snap(page, 'FE-104', 'hit');
  });

  // FE-105 — capped match list: counter shows "+", navigation wraps across the cap.
  test('FE-105 a query with more than 5000 hits shows "N / 5000+"; Next advances; Shift+Enter from 1 wraps to 5000', async ({ page }) => {
    test.setTimeout(LARGE_TIMEOUT);
    const { texts } = largeOracle();
    const query = 'lorem';
    const expected = oracleMatches(texts, query);
    expect(expected).toHaveLength(SEARCH_MATCH_CAP);
    expect(oracleMatches(texts, query, SEARCH_MATCH_CAP + 1)).toHaveLength(SEARCH_MATCH_CAP + 1);

    await loadLarge(page, 'Search FE-105 Collection');

    const input = await openSearch(page);
    await input.fill(query);
    const counter = searchCount(page);
    await expect(counter).toHaveText('1 / 5000+', { timeout: 10000 });
    await expect(activeMarks(page)).toHaveCount(1);
    await snap(page, 'FE-105', 'first');

    const next = page.locator('[data-testid="response-search-next"]');
    const prev = page.locator('[data-testid="response-search-prev"]');
    await next.click();
    await expect(counter).toHaveText('2 / 5000+');
    await next.click();
    await expect(counter).toHaveText('3 / 5000+');

    // The third hit: its row holds the active mark at the hit's ordinal among the value marks.
    const third = expected[2];
    const thirdRow = rowByPath(page, JSON.parse(third.id));
    await expect(thirdRow.locator('mark.response-search-highlight--active')).toHaveCount(1);
    await expect(valueMarks(thirdRow).nth(third.ordinal)).toHaveClass(/response-search-highlight--active/);
    await expect.poll(() => activeMarkInViewport(page), { timeout: 5000 }).toBe(true);

    await prev.click();
    await expect(counter).toHaveText('2 / 5000+');
    await prev.click();
    await expect(counter).toHaveText('1 / 5000+');

    // Shift+Enter in the input wraps from the first hit to the last (capped) one.
    await input.press('Shift+Enter');
    await expect(counter).toHaveText('5000 / 5000+');

    const last = expected[SEARCH_MATCH_CAP - 1];
    const lastRow = rowByPath(page, JSON.parse(last.id));
    await expect(lastRow).toHaveCount(1, { timeout: 10000 });
    await expect(lastRow.locator('mark.response-search-highlight--active')).toHaveCount(1);
    await expect(valueMarks(lastRow).nth(last.ordinal)).toHaveClass(/response-search-highlight--active/);
    await expect(activeMarks(page)).toHaveCount(1);
    await expect.poll(() => activeMarkInViewport(page), { timeout: 5000 }).toBe(true);
    await snap(page, 'FE-105', 'wrapped-to-5000');
  });

  // FE-106 — boundary quotes are stripped: "author" finds the key author.
  test('FE-106 a quoted query "author" matches the key author once, highlighted inside the key', async ({ page }) => {
    await createTestRequest(page, uniqueName('Search FE-106 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/deep.json`);
    await waitForTree(page);

    const input = await openSearch(page);
    await input.fill('"author"');
    await expect(input).toHaveValue('"author"');

    await expect(searchCount(page)).toHaveText('1 / 1');
    await expect(marks(page)).toHaveCount(1);
    const keyMark = page.locator('[data-testid="json-tree-key"] mark.response-search-highlight[data-search-hit="true"]');
    await expect(keyMark).toHaveCount(1);
    await expect(keyMark).toHaveText('author');
    await expect(keyMark).toHaveClass(/response-search-highlight--active/);
    await expect(
      rowByPath(page, ['slideshow', 'author']).locator('[data-testid="json-tree-key"] mark.response-search-highlight'),
    ).toHaveCount(1);
    await expect(page.locator('[data-testid="json-tree-value"] mark.response-search-highlight')).toHaveCount(0);
    await snap(page, 'FE-106', 'key-hit');
  });

  // FE-107 — sticky expansion: closing the bar keeps what the search expanded.
  test('FE-107 after Collapse all + search + close the tree stays expanded; Collapse all and Expand all still work', async ({ page }) => {
    await createTestRequest(page, uniqueName('Search FE-107 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/deep.json`);
    await waitForTree(page);
    await expect(tree(page)).toHaveAttribute('data-total-rows', String(DEEP_TOTAL_ROWS));

    const collapseAll = dock(page).locator('[data-testid="response-collapse-all-btn"]');
    const expandAll = dock(page).locator('[data-testid="response-expand-all-btn"]');

    await collapseAll.click();
    await expect(tree(page)).toHaveAttribute('data-total-rows', '1');
    await expect(tree(page).getByText(DEEP_TEXT, { exact: false })).toHaveCount(0);

    const input = await openSearch(page);
    await input.fill(DEEP_TEXT);
    await expect(searchCount(page)).toHaveText('1 / 3');
    await expect(marks(page)).toHaveCount(3);
    await snap(page, 'FE-107', 'searching');

    await page.locator('[data-testid="response-search-close"]').click();
    await expect(searchInput(page)).toHaveCount(0);
    await expect(marks(page)).toHaveCount(0);
    // The expansion the search reached is kept.
    await expect(tree(page).getByText(DEEP_TEXT, { exact: false }).first()).toBeVisible();
    await expect(rowByPath(page, ['slideshow', 'slides', 1, 'items', 0])).toBeVisible();
    await expect(tree(page)).toHaveAttribute('data-total-rows', String(DEEP_TOTAL_ROWS));
    expect(await totalRows(page)).toBeGreaterThan(1);
    await snap(page, 'FE-107', 'closed-still-expanded');

    await collapseAll.click();
    await expect(tree(page)).toHaveAttribute('data-total-rows', '1');
    await expect(tree(page).getByText(DEEP_TEXT, { exact: false })).toHaveCount(0);
    await snap(page, 'FE-107', 'collapsed-again');

    await expandAll.click();
    await expect(tree(page)).toHaveAttribute('data-total-rows', String(DEEP_TOTAL_ROWS));
    await expect(tree(page).getByText(DEEP_TEXT, { exact: false }).first()).toBeVisible();
    await expect(rowByPath(page, ['slideshow', 'slides', 1, 'items', 1])).toBeVisible();
    await expect(marks(page)).toHaveCount(0);
    await snap(page, 'FE-107', 'expanded');
  });

  // FE-108 — navigating into a container the user collapsed mid-search re-opens it.
  test('FE-108 Next into a container collapsed mid-search re-expands it and shows the active hit', async ({ page }) => {
    await createTestRequest(page, uniqueName('Search FE-108 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/deep.json`);
    await waitForTree(page);

    const input = await openSearch(page);
    await input.fill(DEEP_TEXT);
    const counter = searchCount(page);
    await expect(counter).toHaveText('1 / 3');
    await expect(rowByPath(page, ['slideshow', 'slides', 0, 'title']).locator('mark.response-search-highlight--active'))
      .toHaveCount(1);

    const slide1Path = ['slideshow', 'slides', 1];
    const slide1 = rowByPath(page, slide1Path);
    await expect(slide1).toHaveAttribute('data-expanded', 'true');
    await slide1.locator('[data-testid="json-tree-arrow"]').click();
    await expect(slide1).toHaveAttribute('data-expanded', 'false');
    await expect(rowByPath(page, [...slide1Path, 'items'])).toHaveCount(0);
    await expect(rowByPath(page, [...slide1Path, 'items', 0])).toHaveCount(0);
    const slide1Rows = expandedRowCount(DEEP_FIXTURE.slideshow.slides[1]);
    await expect(tree(page)).toHaveAttribute('data-total-rows', String(DEEP_TOTAL_ROWS - (slide1Rows - 1)));
    // Collapsing does not change the matches or the active one.
    await expect(counter).toHaveText('1 / 3');
    await snap(page, 'FE-108', 'slide1-collapsed');

    await page.locator('[data-testid="response-search-next"]').click();
    await expect(counter).toHaveText('2 / 3');
    await expect(slide1).toHaveAttribute('data-expanded', 'true');
    const item0 = rowByPath(page, [...slide1Path, 'items', 0]);
    await expect(item0).toBeVisible();
    await expect(item0.locator('mark.response-search-highlight--active')).toHaveCount(1);
    await expect(item0.locator('mark.response-search-highlight--active')).toHaveText(DEEP_TEXT);
    await expect(activeMarks(page)).toHaveCount(1);
    await expect.poll(() => activeMarkInViewport(page), { timeout: 5000 }).toBe(true);
    await expect(tree(page)).toHaveAttribute('data-total-rows', String(DEEP_TOTAL_ROWS));
    await snap(page, 'FE-108', 'revealed');
  });

  // FE-109 — non-JSON bodies: no dock, Ctrl+F is not taken over.
  test('FE-109 plain text: no dock, and Ctrl+F inside the viewer opens no search input', async ({ page }) => {
    await createTestRequest(page, uniqueName('Search FE-109 Collection'));
    await sendUrl(page, `${fixture.baseUrl}/plain.txt`);

    const pre = page.locator('.response-viewer pre.response-body');
    await expect(pre).toBeVisible({ timeout: 10000 });
    await expect(pre).toContainText(PLAIN_TEXT_FIXTURE);
    await expect(dock(page)).toHaveCount(0);
    await expect(tree(page)).toHaveCount(0);

    await installFindKeyRecorder(page);
    await pre.click();
    await expect.poll(() => focusInsideViewer(page)).toBe(true);
    await page.keyboard.press('Control+f');

    await expect.poll(() => findKeyLog(page)).toHaveLength(1);
    await expect(searchInput(page)).toHaveCount(0);
    await expect(dock(page)).toHaveCount(0);
    // The hotkey is not handled for non-JSON bodies, so the browser's native find stays available.
    expect(await findKeyLog(page)).toEqual([false]);
    await snap(page, 'FE-109', 'no-search');
  });
});
