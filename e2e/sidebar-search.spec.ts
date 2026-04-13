import { test, expect, Page, Locator } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

// Unique timestamp per run so cleanupTestCollections can tear down our data
const timestamp = Date.now();
const needleBase = `needle-${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

// Serial: these tests share sidebar state and order matters
test.describe.configure({ mode: 'serial' });

/** Sidebar toolbar buttons — selected by title attribute which already exists */
function expandAllButton(page: Page): Locator {
  return page.locator('.sidebar-toolbar button[title="Expand all folders"]');
}
function collapseAllButton(page: Page): Locator {
  return page.locator('.sidebar-toolbar button[title="Collapse all folders"]');
}
function sidebarSearchInput(page: Page): Locator {
  return page.locator('.sidebar-search input[type="text"]');
}

/** Create a root collection via the sidebar "+" button. */
async function createCollection(page: Page, name: string): Promise<Locator> {
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

/** Add a subfolder (nested collection) under an existing collection. */
async function addSubfolder(page: Page, parentHeader: Locator, childName: string): Promise<Locator> {
  await parentHeader.hover();
  await parentHeader.locator('.btn-menu').click();
  const menu = page.locator('.collection-menu');
  await expect(menu).toBeVisible();
  await menu.locator('.request-menu-item').filter({ hasText: 'Add Folder' }).click();
  const prompt = page.locator('.prompt-modal');
  await expect(prompt).toBeVisible({ timeout: 5000 });
  await prompt.locator('.prompt-input').fill(childName);
  await prompt.locator('.prompt-btn-confirm').click();
  await expect(prompt).not.toBeVisible();
  const childHeader = page.locator('.collection-header').filter({ hasText: childName });
  await expect(childHeader).toBeVisible({ timeout: 5000 });
  return childHeader;
}

/** Add a request to a collection via context menu, then rename it via inline rename. */
async function addRequestWithName(page: Page, collectionHeader: Locator, requestName: string): Promise<void> {
  // Count existing requests in this collection so we can locate the newly created one
  const collection = page.locator('.collection').filter({ has: collectionHeader });
  const beforeCount = await collection.locator('.request-item').count();

  await collectionHeader.hover();
  await collectionHeader.locator('.btn-menu').click();
  const menu = page.locator('.collection-menu');
  await expect(menu).toBeVisible();
  await menu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

  // Wait for new request to appear
  await expect(collection.locator('.request-item')).toHaveCount(beforeCount + 1, { timeout: 5000 });

  // The newly created request is the last one
  const newReq = collection.locator('.request-item').last();

  // Rename via context menu
  await newReq.hover();
  await newReq.locator('.btn-menu').click();
  const reqMenu = page.locator('.request-menu').last();
  await expect(reqMenu).toBeVisible();
  await reqMenu.locator('.request-menu-item').filter({ hasText: 'Rename' }).click();
  const renameInput = newReq.locator('.rename-input');
  await expect(renameInput).toBeVisible({ timeout: 5000 });
  await renameInput.fill(requestName);
  await renameInput.press('Enter');

  // Confirm the rename took effect
  await expect(collection.locator('.request-item').filter({ hasText: requestName })).toBeVisible({ timeout: 5000 });
}

async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
}

test.describe('Sidebar expand/collapse during active search', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test('sidebar-search-expand-all — collapse-all/expand-all work while searching', async ({ page }) => {
    // Three sibling collections each with a uniquely-named "needle" request
    const colAName = `SBS-A ${timestamp}`;
    const colBName = `SBS-B ${timestamp}`;
    const colCName = `SBS-C ${timestamp}`;

    const reqAName = `${needleBase}-A`;
    const reqBName = `${needleBase}-B`;
    const reqCName = `${needleBase}-C`;

    const colA = await createCollection(page, colAName);
    await addRequestWithName(page, colA, reqAName);

    const colB = await createCollection(page, colBName);
    await addRequestWithName(page, colB, reqBName);

    const colC = await createCollection(page, colCName);
    await addRequestWithName(page, colC, reqCName);

    // Type the shared needle to filter to the 3 target requests only
    const search = sidebarSearchInput(page);
    await search.fill(needleBase);

    // All 3 matching requests should auto-expand and be visible
    const reqA = page.locator('.request-item').filter({ hasText: reqAName });
    const reqB = page.locator('.request-item').filter({ hasText: reqBName });
    const reqC = page.locator('.request-item').filter({ hasText: reqCName });

    await expect(reqA).toBeVisible({ timeout: 5000 });
    await expect(reqB).toBeVisible({ timeout: 5000 });
    await expect(reqC).toBeVisible({ timeout: 5000 });

    // Click collapse-all — while searching, matching collection headers should collapse, hiding requests
    await collapseAllButton(page).click();
    // Give React a tick to apply the collapse
    await page.waitForTimeout(300);

    // No request items should be visible anywhere in the sidebar
    await expect(page.locator('.sidebar .request-item')).toHaveCount(0, { timeout: 2000 });

    // But the 3 collection headers are still visible (matching collections still shown)
    await expect(page.locator('.collection-header').filter({ hasText: colAName })).toBeVisible();
    await expect(page.locator('.collection-header').filter({ hasText: colBName })).toBeVisible();
    await expect(page.locator('.collection-header').filter({ hasText: colCName })).toBeVisible();

    // Click expand-all — all 3 matching requests should become visible again
    await expandAllButton(page).click();
    await page.waitForTimeout(300);

    await expect(reqA).toBeVisible({ timeout: 2000 });
    await expect(reqB).toBeVisible({ timeout: 2000 });
    await expect(reqC).toBeVisible({ timeout: 2000 });
  });

  test('sidebar-search-individual-toggle — clicking one collection toggles only that one', async ({ page }) => {
    // Reuse the collections created in the previous test (serial mode)
    const colAName = `SBS-A ${timestamp}`;
    const colBName = `SBS-B ${timestamp}`;
    const colCName = `SBS-C ${timestamp}`;
    const reqAName = `${needleBase}-A`;
    const reqBName = `${needleBase}-B`;
    const reqCName = `${needleBase}-C`;

    // Activate search
    const search = sidebarSearchInput(page);
    await search.fill(needleBase);

    const colAHeader = page.locator('.collection-header').filter({ hasText: colAName });
    const colBHeader = page.locator('.collection-header').filter({ hasText: colBName });
    const colCHeader = page.locator('.collection-header').filter({ hasText: colCName });

    await expect(colAHeader).toBeVisible({ timeout: 5000 });
    await expect(colBHeader).toBeVisible({ timeout: 5000 });
    await expect(colCHeader).toBeVisible({ timeout: 5000 });

    // Collapse-all so all 3 collections are folded
    await collapseAllButton(page).click();
    await page.waitForTimeout(300);

    await expect(page.locator('.sidebar .request-item')).toHaveCount(0, { timeout: 2000 });

    // Click A's chevron (collection-arrow) to expand only A
    await colAHeader.locator('.collection-arrow').click();
    await page.waitForTimeout(300);

    // A's request should now be visible; B and C should still be hidden
    await expect(page.locator('.request-item').filter({ hasText: reqAName })).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.request-item').filter({ hasText: reqBName })).toHaveCount(0);
    await expect(page.locator('.request-item').filter({ hasText: reqCName })).toHaveCount(0);
  });

  test('sidebar-expand-all-nested-no-search — expand-all opens nested subfolders', async ({ page }) => {
    // Clear any lingering search so we're in no-search mode
    const search = sidebarSearchInput(page);
    await search.fill('');

    // Build Root > Child > request
    const rootName = `SBS-Root ${timestamp}`;
    const childName = `SBS-Child ${timestamp}`;
    const nestedReqName = `SBS-nested-req ${timestamp}`;

    const rootHeader = await createCollection(page, rootName);
    const childHeader = await addSubfolder(page, rootHeader, childName);
    await addRequestWithName(page, childHeader, nestedReqName);

    // Collapse everything so we start from a known state
    await collapseAllButton(page).click();
    await page.waitForTimeout(300);

    // Child header should be hidden because root is collapsed
    await expect(page.locator('.collection-header').filter({ hasText: childName })).toHaveCount(0);

    // Now expand-all (with no search): should open root AND nested child
    await expandAllButton(page).click();
    await page.waitForTimeout(300);

    // Root is expanded (child visible) and child is expanded (nested request visible)
    await expect(page.locator('.collection-header').filter({ hasText: childName })).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.request-item').filter({ hasText: nestedReqName })).toBeVisible({ timeout: 2000 });
  });
});
