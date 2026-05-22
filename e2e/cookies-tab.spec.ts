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

// A cookie whose value is long enough to be truncated by the Value column.
// 'e2e_long=<60 'a's>; Path=/' — un-folded by the proxy into result.setCookies.
const LONG_COOKIE_VALUE = 'a'.repeat(60);
const LONG_COOKIE_URL =
  `https://httpbin.org/response-headers?Set-Cookie=e2e_long%3D${LONG_COOKIE_VALUE}%3B%20Path%3D%2F`;

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

  // GH-57 item 1 — Value column truncate + click-to-expand.
  // The value cell is truncated by default (class present, not expanded). Clicking the
  // cell toggles the `expanded` class on; clicking again toggles it off.
  test('value-cell-truncates-and-toggles-expanded-on-click', async ({ page }) => {
    const collectionName = uniqueName('Cookies Tab Value Expand Collection');
    await createTestRequest(page, collectionName);

    // Send a real request whose Set-Cookie carries a long value so the cell truncates.
    await page.locator('.url-input').fill(LONG_COOKIE_URL);
    await sendRequestAndWaitForResponse(page);

    const cookiesTab = page.locator('[data-testid="response-tab-cookies"]');
    await expect(cookiesTab).toBeVisible({ timeout: 10000 });
    await cookiesTab.click();

    const cookiesTable = page.locator('[data-testid="response-cookies"]');
    await expect(cookiesTable).toBeVisible();

    // Operate on the first cookie row's value cell.
    const row = cookiesTable.locator('[data-testid="cookie-row"]').first();
    await expect(row).toBeVisible({ timeout: 5000 });

    const valueCell = row.locator('.cookie-value-cell').first();
    await expect(valueCell).toBeVisible({ timeout: 5000 });

    // Default state: truncated cell, not expanded.
    await expect(valueCell).toHaveClass(/cookie-value-cell/);
    await expect(valueCell).not.toHaveClass(/expanded/);

    // Click → expands.
    await valueCell.click();
    await expect(valueCell).toHaveClass(/expanded/);

    // Click again → collapses.
    await valueCell.click();
    await expect(valueCell).not.toHaveClass(/expanded/);
  });

  // GH-57 AC#1 — Value cell carries the data-testid and is CSS-truncated by default:
  // single-line (white-space:nowrap), ellipsis, overflow hidden, and a bounded max-width
  // so a long value does not blow out the column.
  test('value-cell-has-testid-and-is-truncated-by-default', async ({ page }) => {
    const collectionName = uniqueName('Cookies Tab Value Truncate Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(LONG_COOKIE_URL);
    await sendRequestAndWaitForResponse(page);

    const cookiesTab = page.locator('[data-testid="response-tab-cookies"]');
    await expect(cookiesTab).toBeVisible({ timeout: 10000 });
    await cookiesTab.click();

    const cookiesTable = page.locator('[data-testid="response-cookies"]');
    await expect(cookiesTable).toBeVisible();

    const row = cookiesTable.locator('[data-testid="cookie-row"]').first();
    await expect(row).toBeVisible({ timeout: 5000 });

    // The Value <td> carries the new data-testid.
    const valueCell = row.locator('[data-testid="cookie-value-cell"]').first();
    await expect(valueCell).toBeVisible({ timeout: 5000 });

    // The full long value is present in the DOM (truncation is purely visual).
    await expect(valueCell).toContainText(LONG_COOKIE_VALUE);

    // Computed style: single-line truncated with ellipsis and clipped overflow.
    const style = await valueCell.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow,
        overflow: cs.overflow,
        overflowX: cs.overflowX,
        maxWidth: cs.maxWidth,
        clientWidth: (el as HTMLElement).clientWidth,
      };
    });

    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
    // `overflow` may compute to the shorthand or the per-axis value; accept either form
    // as long as the content is hidden (not visible/scroll/auto would still clip via ellipsis,
    // but the spec requires hidden).
    expect([style.overflow, style.overflowX]).toContain('hidden');

    // Bounded max-width — NOT `none`, and a sane cap (~280px per spec, allow some slack).
    expect(style.maxWidth).not.toBe('none');
    const maxWidthPx = parseFloat(style.maxWidth);
    expect(Number.isNaN(maxWidthPx)).toBe(false);
    expect(maxWidthPx).toBeGreaterThan(0);
    expect(maxWidthPx).toBeLessThanOrEqual(400);

    // The long value does not blow out the column: the cell's rendered width
    // stays within its max-width bound (with a small tolerance for padding/border rounding).
    expect(style.clientWidth).toBeLessThanOrEqual(maxWidthPx + 4);
  });

  // GH-57 AC#1 — Clicking the value cell reveals the full value by WRAPPING (line breaks),
  // not by widening: white-space becomes normal/pre-wrap/break-spaces, word-break/overflow-wrap
  // allows breaking, and max-width stays bounded. Toggling again collapses back to truncated.
  test('value-cell-reveals-by-wrapping-on-click-and-collapses-back', async ({ page }) => {
    const collectionName = uniqueName('Cookies Tab Value Wrap Collection');
    await createTestRequest(page, collectionName);

    await page.locator('.url-input').fill(LONG_COOKIE_URL);
    await sendRequestAndWaitForResponse(page);

    const cookiesTab = page.locator('[data-testid="response-tab-cookies"]');
    await expect(cookiesTab).toBeVisible({ timeout: 10000 });
    await cookiesTab.click();

    const cookiesTable = page.locator('[data-testid="response-cookies"]');
    await expect(cookiesTable).toBeVisible();

    const row = cookiesTable.locator('[data-testid="cookie-row"]').first();
    await expect(row).toBeVisible({ timeout: 5000 });

    const valueCell = row.locator('[data-testid="cookie-value-cell"]').first();
    await expect(valueCell).toBeVisible({ timeout: 5000 });

    // Helper to read the wrap-relevant computed styles.
    const readStyle = () =>
      valueCell.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          whiteSpace: cs.whiteSpace,
          wordBreak: cs.wordBreak,
          overflowWrap: (cs as any).overflowWrap || (cs as any).wordWrap,
          maxWidth: cs.maxWidth,
        };
      });

    // Default: truncated (single line).
    const before = await readStyle();
    expect(before.whiteSpace).toBe('nowrap');

    // Click → reveal by wrapping.
    await valueCell.click();
    await expect(valueCell).toHaveClass(/expanded/);

    const expanded = await readStyle();
    // Wrapping is enabled: white-space is one of the wrapping modes.
    expect(['normal', 'pre-wrap', 'break-spaces']).toContain(expanded.whiteSpace);
    // Breaking long unbreakable values is allowed via word-break or overflow-wrap.
    const canBreak =
      ['break-all', 'break-word'].includes(expanded.wordBreak) ||
      ['break-word', 'anywhere'].includes(expanded.overflowWrap);
    expect(canBreak).toBe(true);
    // Reveal is by wrapping, NOT by widening: max-width stays bounded.
    expect(expanded.maxWidth).not.toBe('none');
    const expandedMaxWidth = parseFloat(expanded.maxWidth);
    expect(Number.isNaN(expandedMaxWidth)).toBe(false);
    expect(expandedMaxWidth).toBeLessThanOrEqual(400);

    // Click again → collapses back to truncated single-line. Move the pointer off
    // the cell first: the cell also reveals on :hover, and after a click the pointer
    // is still over it — so we must de-hover to observe the collapsed (toggled) state.
    await valueCell.click();
    await expect(valueCell).not.toHaveClass(/expanded/);
    await page.mouse.move(0, 0);
    const after = await readStyle();
    expect(after.whiteSpace).toBe('nowrap');
  });
});
