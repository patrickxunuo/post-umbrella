import { test, expect, Page } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

/** Create a collection via sidebar and return its header locator */
async function createCollection(page: Page, name: string) {
  const addBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addBtn).toBeEnabled({ timeout: 10000 });
  await addBtn.click();
  const modal = page.locator('.prompt-modal');
  await expect(modal).toBeVisible({ timeout: 5000 });
  await modal.locator('.prompt-input').fill(name);
  await modal.locator('.prompt-btn-confirm').click();
  await expect(modal).not.toBeVisible();
  const header = page.locator('.collection-header').filter({ hasText: name });
  await expect(header).toBeVisible({ timeout: 5000 });
  return header;
}

/** Add a request to a collection via its context menu */
async function addRequest(page: Page, collectionHeader: ReturnType<Page['locator']>) {
  await collectionHeader.hover();
  await collectionHeader.locator('.btn-menu').click();
  const menu = page.locator('.collection-menu');
  await expect(menu).toBeVisible();
  await menu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();
  await page.waitForTimeout(400);
}

/** Rename a request in the sidebar via its item context menu */
async function renameRequestViaMenu(page: Page, requestItem: ReturnType<Page['locator']>, newName: string) {
  await requestItem.hover();
  await requestItem.locator('.btn-menu').click();
  const menu = page.locator('.request-menu').last();
  await expect(menu).toBeVisible();
  await menu.locator('.request-menu-item').filter({ hasText: 'Rename' }).click();
  const input = requestItem.locator('.rename-input');
  await expect(input).toBeVisible();
  await input.fill(newName);
  await input.press('Enter');
  await page.waitForTimeout(300);
}

/**
 * Open `count` request tabs with distinct names inside a fresh collection.
 * Returns the created collection name and the ordered list of request names.
 * Tabs end up in the same order in the tab bar (leftmost = names[0]).
 */
async function openRequestsInTabs(page: Page, collectionBase: string, count: number) {
  const collectionName = uniqueName(collectionBase);
  const header = await createCollection(page, collectionName);

  const collection = page.locator('.collection').filter({
    has: page.locator('.collection-header').filter({ hasText: collectionName }),
  });

  // Create `count` requests
  for (let i = 0; i < count; i++) {
    await addRequest(page, header);
  }

  const requests = collection.locator('.request-item');
  await expect(requests).toHaveCount(count, { timeout: 5000 });

  // Rename each to a stable, unique name
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nm = `Tab-${String.fromCharCode(65 + i)}-${timestamp}`;
    names.push(nm);
    await renameRequestViaMenu(page, requests.nth(i), nm);
  }

  // Click each request (left-to-right) to open tabs in that order.
  // Single-clicking a request opens it as a *preview* tab which the next click
  // would replace. Promote each preview to a persistent tab by typing into the
  // URL (making it dirty) then reverting (clean again) — that clears
  // previewTabId without leaving residual dirty state.
  for (const nm of names) {
    const item = collection.locator('.request-item').filter({ hasText: nm });
    await item.click();
    const tab = page.locator('.open-tab').filter({ hasText: nm });
    await expect(tab).toBeVisible({ timeout: 5000 });
    const urlInput = page.locator('.url-input');
    await expect(urlInput).toBeVisible({ timeout: 5000 });
    // Promote: fill a value (dirty → preview cleared), then revert (clean again).
    await urlInput.fill('x');
    await expect(tab).not.toHaveClass(/\bpreview\b/, { timeout: 5000 });
    await urlInput.fill('');
    // Wait for the tab to be clean again (dirty class removed).
    await expect(tab).not.toHaveClass(/\bdirty\b/, { timeout: 5000 });
  }

  // Confirm tab count
  await expect(page.locator('.open-tab')).toHaveCount(count, { timeout: 5000 });

  return { collectionName, names };
}

/** Make the currently active tab dirty by typing into its URL input */
async function makeTabDirty(page: Page, name: string) {
  // Click the tab to make it active
  const tab = page.locator('.open-tab').filter({ hasText: name });
  await tab.click();
  await expect(tab).toHaveClass(/active/);
  // Wait for the editor to catch up
  await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
  const urlInput = page.locator('.url-input');
  await urlInput.click();
  await urlInput.fill(`https://example.com/${name}`);
  // Dirty indicator should appear on the tab
  await expect(tab.locator('.tab-dirty')).toBeVisible({ timeout: 5000 });
}

/** Right-click a tab by visible name */
async function rightClickTab(page: Page, name: string) {
  const tab = page.locator('.open-tab').filter({ hasText: name });
  await tab.click({ button: 'right' });
  await expect(page.locator('[data-testid="tab-context-menu"]')).toBeVisible({ timeout: 5000 });
}

test.describe('Tab Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('tab-menu-opens-on-right-click', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM Open Menu', 3);

    // Right-click the middle tab
    await rightClickTab(page, names[1]);

    const menu = page.locator('[data-testid="tab-context-menu"]');
    await expect(menu).toBeVisible();

    // Escape dismisses
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible({ timeout: 5000 });
  });

  test('tab-menu-close', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM Close', 3);

    // Activate the rightmost tab
    const rightTab = page.locator('.open-tab').filter({ hasText: names[2] });
    await rightTab.click();
    await expect(rightTab).toHaveClass(/active/);

    // Right-click the active (rightmost) tab and close it
    await rightClickTab(page, names[2]);
    await page.locator('[data-testid="tab-menu-close"]').click();

    // 2 tabs remain
    await expect(page.locator('.open-tab')).toHaveCount(2, { timeout: 5000 });

    // Rightmost tab is gone
    await expect(page.locator('.open-tab').filter({ hasText: names[2] })).not.toBeVisible();

    // Since the active tab was closed and there is no right neighbor,
    // focus should fall back to the left neighbor (names[1] — the middle tab).
    const middleTab = page.locator('.open-tab').filter({ hasText: names[1] });
    await expect(middleTab).toHaveClass(/active/, { timeout: 5000 });
  });

  test('tab-menu-close-others', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM Close Others', 3);

    await rightClickTab(page, names[1]);
    await page.locator('[data-testid="tab-menu-close-others"]').click();

    // Only the middle tab remains
    await expect(page.locator('.open-tab')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.open-tab').filter({ hasText: names[1] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[0] })).not.toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[2] })).not.toBeVisible();
  });

  test('tab-menu-close-others-hidden-for-single-tab', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM Single Tab', 1);

    await rightClickTab(page, names[0]);

    const menu = page.locator('[data-testid="tab-context-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="tab-menu-close-others"]')).toHaveCount(0);
  });

  test('tab-menu-close-left', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM CloseLeft', 3);

    await rightClickTab(page, names[1]);

    const menu = page.locator('[data-testid="tab-context-menu"]');
    await expect(menu.locator('[data-testid="tab-menu-close-left"]')).toBeVisible();
    await expect(menu.locator('[data-testid="tab-menu-close-right"]')).toBeVisible();

    await menu.locator('[data-testid="tab-menu-close-left"]').click();

    // 2 rightmost remain (middle + right)
    await expect(page.locator('.open-tab').filter({ hasText: names[0] })).not.toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[1] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[2] })).toBeVisible();
  });

  test('tab-menu-close-right', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM CloseRight', 3);

    await rightClickTab(page, names[1]);
    await page.locator('[data-testid="tab-menu-close-right"]').click();

    // 2 leftmost remain (left + middle)
    await expect(page.locator('.open-tab').filter({ hasText: names[0] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[1] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[2] })).not.toBeVisible();
  });

  test('tab-menu-close-left-hidden-for-leftmost', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM Edge Tabs', 3);

    // Leftmost — close-left should be hidden
    await rightClickTab(page, names[0]);
    let menu = page.locator('[data-testid="tab-context-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="tab-menu-close-left"]')).toHaveCount(0);
    // close-right still available (there are tabs on the right)
    await expect(menu.locator('[data-testid="tab-menu-close-right"]')).toBeVisible();

    // Dismiss
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible({ timeout: 5000 });

    // Rightmost — close-right should be hidden
    await rightClickTab(page, names[2]);
    menu = page.locator('[data-testid="tab-context-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="tab-menu-close-right"]')).toHaveCount(0);
    await expect(menu.locator('[data-testid="tab-menu-close-left"]')).toBeVisible();
  });

  test('tab-menu-close-unmodified-keeps-dirty', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM Unmodified', 3);

    // Make the middle tab dirty
    await makeTabDirty(page, names[1]);

    // Right-click the leftmost (clean) tab
    await rightClickTab(page, names[0]);

    const menu = page.locator('[data-testid="tab-context-menu"]');
    await expect(menu.locator('[data-testid="tab-menu-close-unmodified"]')).toBeVisible();
    await menu.locator('[data-testid="tab-menu-close-unmodified"]').click();

    // Leftmost (clicked) and middle (dirty) remain; rightmost (clean) gone
    await expect(page.locator('.open-tab')).toHaveCount(2, { timeout: 5000 });
    await expect(page.locator('.open-tab').filter({ hasText: names[0] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[1] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[2] })).not.toBeVisible();
  });

  test('tab-menu-close-unmodified-hidden-when-no-clean-others', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM NoClean', 3);

    // Make every non-clicked tab dirty (we will click names[0]).
    await makeTabDirty(page, names[1]);
    await makeTabDirty(page, names[2]);

    // The clicked tab (names[0]) is clean; all others are dirty.
    await rightClickTab(page, names[0]);

    const menu = page.locator('[data-testid="tab-context-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="tab-menu-close-unmodified"]')).toHaveCount(0);
  });

  test('tab-menu-bulk-dirty-confirm', async ({ page }) => {
    const { names } = await openRequestsInTabs(page, 'TCM Bulk Dirty', 3);

    // Make names[0] and names[2] dirty; names[1] stays clean.
    await makeTabDirty(page, names[0]);
    await makeTabDirty(page, names[2]);

    // Right-click the clean tab, click Close Others
    await rightClickTab(page, names[1]);
    await page.locator('[data-testid="tab-menu-close-others"]').click();

    // Confirm modal appears listing the 2 dirty tab names
    const confirmModal = page.locator('.confirm-modal');
    await expect(confirmModal).toBeVisible({ timeout: 5000 });

    const list = confirmModal.locator('[data-testid="confirm-list"]');
    await expect(list).toBeVisible();
    await expect(list).toContainText(names[0]);
    await expect(list).toContainText(names[2]);
    // Clean tab not listed
    await expect(list).not.toContainText(names[1]);

    // Cancel → all 3 tabs still open
    await confirmModal.locator('.confirm-btn-cancel').click();
    await expect(confirmModal).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.open-tab')).toHaveCount(3, { timeout: 5000 });
    await expect(page.locator('.open-tab').filter({ hasText: names[0] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[1] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[2] })).toBeVisible();

    // Re-do: right-click the clean tab, Close Others, Confirm
    await rightClickTab(page, names[1]);
    await page.locator('[data-testid="tab-menu-close-others"]').click();
    const confirmModal2 = page.locator('.confirm-modal');
    await expect(confirmModal2).toBeVisible({ timeout: 5000 });
    await confirmModal2.locator('.confirm-btn-confirm').click();
    await expect(confirmModal2).not.toBeVisible({ timeout: 5000 });

    // Only the clicked (clean) tab remains
    await expect(page.locator('.open-tab')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.open-tab').filter({ hasText: names[1] })).toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[0] })).not.toBeVisible();
    await expect(page.locator('.open-tab').filter({ hasText: names[2] })).not.toBeVisible();
  });
});
