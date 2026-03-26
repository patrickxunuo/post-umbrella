import { test, expect } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

async function waitForApp(page) {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
}

async function createCollection(page, name: string) {
  const addBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addBtn).toBeEnabled({ timeout: 10000 });
  await addBtn.click();
  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible();
  await promptModal.locator('.prompt-input').fill(name);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();
  await expect(page.locator('.collection-header').filter({ hasText: name })).toBeVisible({ timeout: 5000 });
}

test.describe('Collection Auth & Scripts', () => {
  const collectionName = uniqueName('Auth Test Collection');

  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('user can set Bearer Token auth on a collection', async ({ page }) => {
    await createCollection(page, collectionName);

    // Click collection to open tab
    const header = page.locator('.collection-header').filter({ hasText: collectionName });
    await header.locator('.collection-name').click();
    await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });

    // Click Auth tab
    const authTab = page.locator('.collection-editor-tab').filter({ hasText: 'Auth' });
    await authTab.click();

    // Select Bearer Token
    const bearerRadio = page.locator('.auth-type-selector label').filter({ hasText: 'Bearer Token' });
    await bearerRadio.click();

    // Enter token
    const tokenInput = page.locator('.auth-token-field');
    await expect(tokenInput).toBeVisible();
    await tokenInput.fill('my-test-token-123');

    // Save
    const saveBtn = page.locator('.collection-editor-tabs .btn-primary');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Verify save succeeded (button disabled again)
    await expect(saveBtn).toBeDisabled({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/coll-auth-bearer.png' });
  });

  test('request can inherit auth from parent collection', async ({ page }) => {
    // Ensure collection with bearer auth exists
    const header = page.locator('.collection-header').filter({ hasText: collectionName });
    if (!await header.isVisible()) {
      await createCollection(page, collectionName);
      // Set auth
      await header.locator('.collection-name').click();
      await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });
      await page.locator('.collection-editor-tab').filter({ hasText: 'Auth' }).click();
      await page.locator('.auth-type-selector label').filter({ hasText: 'Bearer Token' }).click();
      await page.locator('.auth-token-field').fill('my-test-token-123');
      await page.locator('.collection-editor-tabs .btn-primary').click();
    }

    // Add a request to this collection
    await header.hover();
    const moreBtn = header.locator('.btn-menu');
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    const menu = page.locator('.collection-menu');
    await expect(menu).toBeVisible();
    await menu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

    // Wait for request editor
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    // Go to Auth tab in request
    await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();

    // Select "Inherit from Parent"
    const inheritRadio = page.locator('.auth-type-selector label').filter({ hasText: 'Inherit from Parent' });
    await expect(inheritRadio).toBeVisible();
    await inheritRadio.click();

    // Verify hint text shows
    await expect(page.locator('.hint').filter({ hasText: 'inherited from the parent' })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/coll-auth-inherit.png' });
  });

  test('collection pre-script tab is visible for root collections', async ({ page }) => {
    const header = page.locator('.collection-header').filter({ hasText: collectionName });
    if (!await header.isVisible()) {
      await createCollection(page, collectionName);
    }

    // Open collection tab
    await header.locator('.collection-name').click();
    await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });

    // Verify Pre-script tab exists
    const preScriptTab = page.locator('.collection-editor-tab').filter({ hasText: 'Pre-script' });
    await expect(preScriptTab).toBeVisible();

    // Click it
    await preScriptTab.click();

    // Verify script editor appears
    await expect(page.locator('.script-editor-wrapper')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.script-help')).toBeVisible();

    // Verify help text mentions pm.collectionVariables
    await expect(page.locator('.script-help pre')).toContainText('pm.collectionVariables');

    await page.screenshot({ path: 'e2e/screenshots/coll-script-pre.png' });
  });

  test('collection post-script tab is visible for root collections', async ({ page }) => {
    const header = page.locator('.collection-header').filter({ hasText: collectionName });
    if (!await header.isVisible()) {
      await createCollection(page, collectionName);
    }

    // Open collection tab
    await header.locator('.collection-name').click();
    await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });

    // Verify Post-script tab exists
    const postScriptTab = page.locator('.collection-editor-tab').filter({ hasText: 'Post-script' });
    await expect(postScriptTab).toBeVisible();

    // Click it
    await postScriptTab.click();

    // Verify script editor appears
    await expect(page.locator('.script-editor-wrapper')).toBeVisible({ timeout: 5000 });

    // Verify help text mentions pm.response
    await expect(page.locator('.script-help pre')).toContainText('pm.response.json()');

    await page.screenshot({ path: 'e2e/screenshots/coll-script-post.png' });
  });
});
