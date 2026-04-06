import { test, expect, Page } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

// Run tests serially — drag-and-drop is sensitive to sidebar element positions
test.describe.configure({ mode: 'serial' });

/** Create a collection via sidebar and return its header locator */
async function createCollection(page: Page, name: string) {
  const addBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await addBtn.click();
  const modal = page.locator('.prompt-modal');
  await expect(modal).toBeVisible();
  await modal.locator('.prompt-input').fill(name);
  await modal.locator('.prompt-btn-confirm').click();
  await expect(modal).not.toBeVisible();
  const header = page.locator('.collection-header').filter({ hasText: name });
  await expect(header).toBeVisible({ timeout: 5000 });
  return header;
}

/** Add a request to a collection via context menu */
async function addRequest(page: Page, collectionHeader: ReturnType<Page['locator']>) {
  await collectionHeader.hover();
  await collectionHeader.locator('.btn-menu').click();
  const menu = page.locator('.collection-menu');
  await expect(menu).toBeVisible();
  await menu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();
  await page.waitForTimeout(500);
}

/** Get ordered request names inside a collection */
async function getRequestNames(page: Page, collectionName: string): Promise<string[]> {
  const collection = page.locator('.collection').filter({
    has: page.locator('.collection-header').filter({ hasText: collectionName }),
  });
  const names = await collection.locator('.request-item .request-name').allTextContents();
  return names;
}

/** Rename the currently selected request via its tab */
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

test.describe('Advanced Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
    await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  });

  test('user can reorder requests via drag and drop', async ({ page }) => {
    const collectionName = uniqueName('DnD Reorder');
    const collectionHeader = await createCollection(page, collectionName);

    // Create 3 requests
    await addRequest(page, collectionHeader);
    await addRequest(page, collectionHeader);
    await addRequest(page, collectionHeader);

    // Rename them to A, B, C so we can track order
    const collection = page.locator('.collection').filter({
      has: page.locator('.collection-header').filter({ hasText: collectionName }),
    });
    const requests = collection.locator('.request-item');
    await expect(requests).toHaveCount(3, { timeout: 5000 });

    await renameRequestViaMenu(page, requests.nth(0), 'Req-A');
    await renameRequestViaMenu(page, requests.nth(1), 'Req-B');
    await renameRequestViaMenu(page, requests.nth(2), 'Req-C');

    // Verify initial order
    let names = await getRequestNames(page, collectionName);
    expect(names).toEqual(['Req-A', 'Req-B', 'Req-C']);

    // Drag C onto A (C should move before A → C, A, B)
    const reqC = collection.locator('.request-item').filter({ hasText: 'Req-C' });
    const reqA = collection.locator('.request-item').filter({ hasText: 'Req-A' });
    await reqC.scrollIntoViewIfNeeded();
    await reqA.scrollIntoViewIfNeeded();
    await reqC.dragTo(reqA, { timeout: 5000 });

    // Wait for optimistic update
    await page.waitForTimeout(500);

    // Verify new order
    names = await getRequestNames(page, collectionName);
    expect(names).toEqual(['Req-C', 'Req-A', 'Req-B']);
  });

  test('user can move request into a subfolder via drag and drop', async ({ page }) => {
    const collectionName = uniqueName('DnD Move');
    const folderName = uniqueName('DnD Subfolder');

    const collectionHeader = await createCollection(page, collectionName);

    // Add a request to the root collection
    await addRequest(page, collectionHeader);
    const rootCollection = page.locator('.collection').filter({
      has: page.locator('.collection-header').filter({ hasText: collectionName }),
    });
    await expect(rootCollection.locator('.request-item')).toHaveCount(1, { timeout: 5000 });

    // Create a subfolder via context menu
    await collectionHeader.hover();
    await collectionHeader.locator('.btn-menu').click();
    const menu = page.locator('.collection-menu');
    await expect(menu).toBeVisible();
    await menu.locator('.request-menu-item').filter({ hasText: 'Add Folder' }).click();
    const folderPrompt = page.locator('.prompt-modal');
    await expect(folderPrompt).toBeVisible();
    await folderPrompt.locator('.prompt-input').fill(folderName);
    await folderPrompt.locator('.prompt-btn-confirm').click();
    await expect(folderPrompt).not.toBeVisible();

    const folderHeader = page.locator('.collection-header').filter({ hasText: folderName });
    await expect(folderHeader).toBeVisible({ timeout: 5000 });

    // Drag the request onto the subfolder header
    const request = rootCollection.locator('.request-item').first();
    await request.dragTo(folderHeader);

    await page.waitForTimeout(500);

    // Request should appear inside the subfolder (expand it first)
    await folderHeader.click();
    const subfolder = page.locator('.collection').filter({
      has: page.locator('.collection-header').filter({ hasText: folderName }),
    });
    await expect(subfolder.locator('.request-item')).toHaveCount(1, { timeout: 5000 });
  });

  test('user can create nested sub-collections', async ({ page }) => {
    const parentCollectionName = uniqueName('Parent Collection');
    const childCollectionName = uniqueName('Child Folder');

    const parentCollectionHeader = await createCollection(page, parentCollectionName);

    // Open context menu and add folder
    await parentCollectionHeader.hover();
    await parentCollectionHeader.locator('.btn-menu').click();
    const collectionMenu = page.locator('.collection-menu');
    await expect(collectionMenu).toBeVisible();
    await collectionMenu.locator('.request-menu-item').filter({ hasText: 'Add Folder' }).click();

    const folderPrompt = page.locator('.prompt-modal');
    await expect(folderPrompt).toBeVisible({ timeout: 5000 });
    await folderPrompt.locator('.prompt-input').fill(childCollectionName);
    await folderPrompt.locator('.prompt-btn-confirm').click();
    await expect(folderPrompt).not.toBeVisible();

    const childCollectionHeader = page.locator('.collection-header').filter({ hasText: childCollectionName });
    await expect(childCollectionHeader).toBeVisible({ timeout: 5000 });
    await expect(childCollectionHeader.locator('.folder-icon')).toBeVisible();
  });
});
