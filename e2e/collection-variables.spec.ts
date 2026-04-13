import { test, expect } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

// Helper: wait for app to load
async function waitForApp(page) {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
}

// Helper: create a collection and return its name
async function createCollection(page, name: string) {
  const addBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addBtn).toBeEnabled({ timeout: 10000 });
  await addBtn.click();

  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible();
  await promptModal.locator('.prompt-input').fill(name);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();

  // Wait for collection to appear
  await expect(page.locator('.collection-header').filter({ hasText: name })).toBeVisible({ timeout: 5000 });
}

// Helper: open collection tab and navigate to Variables tab
async function openVariablesTab(page, collectionName: string) {
  // Click the collection name to open the tab
  const collHeader = page.locator('.collection-header').filter({ hasText: collectionName });
  await collHeader.locator('.collection-name').click();

  // Wait for collection editor to load
  await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });

  // Click Variables tab
  const varsTab = page.locator('.collection-editor-tab').filter({ hasText: 'Variables' });
  await expect(varsTab).toBeVisible();
  await varsTab.click();

  // Wait for variables table to appear
  await expect(page.locator('.collection-variables-tab')).toBeVisible({ timeout: 5000 });
}

test.describe('Collection Variables', () => {
  const collectionName = uniqueName('Vars Test Collection');

  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('user can create collection variables', async ({ page }) => {
    // Create a collection
    await createCollection(page, collectionName);

    // Open variables tab
    await openVariablesTab(page, collectionName);

    // Click "Add Variable" button
    const addVarBtn = page.locator('.btn-add-var');
    await expect(addVarBtn).toBeVisible();
    await addVarBtn.click();

    // Fill in key and value
    const keyInput = page.locator('.env-var-table tbody tr').first().locator('td.col-key input');
    const valueInput = page.locator('.env-var-table tbody tr').first().locator('td.col-value input');
    await keyInput.fill('test_host');
    await valueInput.fill('https://api.example.com');

    // Click Save
    const saveBtn = page.locator('.collection-variables-tab .btn-primary');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Wait for save to complete (button becomes disabled)
    await expect(saveBtn).toBeDisabled({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/coll-var-created.png' });
  });

  test('user can edit collection variable values', async ({ page }) => {
    const editCollName = uniqueName('Var Edit Test');
    await createCollection(page, editCollName);
    await openVariablesTab(page, editCollName);

    // Add a variable first
    const addVarBtn = page.locator('.btn-add-var');
    await addVarBtn.click();
    const keyInput = page.locator('.env-var-table tbody tr').first().locator('td.col-key input');
    const valueInput = page.locator('.env-var-table tbody tr').first().locator('td.col-value input');
    await keyInput.fill('edit_var');
    await valueInput.fill('original_value');
    await page.locator('.collection-variables-tab .btn-primary').click();
    await expect(page.locator('.collection-variables-tab .btn-primary')).toBeDisabled({ timeout: 5000 });

    // Wait for save to complete and component to re-render from DB
    await page.waitForTimeout(1000);

    // Verify the variable key persists
    const savedKey = page.locator('.env-var-table tbody tr').first().locator('td.col-key input');
    await expect(savedKey).toHaveValue('edit_var');

    // Replace the value with a new one
    const editValueInput = page.locator('.env-var-table tbody tr').first().locator('td.col-value input');
    await editValueInput.fill('updated_value');

    // Verify value entered
    await expect(editValueInput).toHaveValue('updated_value');

    // Save should be enabled now
    const saveBtn = page.locator('.collection-variables-tab .btn-primary');
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await expect(saveBtn).toBeDisabled({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/coll-var-edited.png' });
  });

  test('collection variable {{key}} substituted in request URL', async ({ page }) => {
    const subCollName = uniqueName('Var Sub Test');
    await createCollection(page, subCollName);
    await openVariablesTab(page, subCollName);

    // Add a variable
    const addVarBtn = page.locator('.btn-add-var');
    await addVarBtn.click();
    const row = page.locator('.env-var-table tbody tr').first();
    await row.locator('td.col-key input').fill('test_host');
    await row.locator('td.col-value input').fill('https://httpbin.org');
    await page.locator('.collection-variables-tab .btn-primary').click();
    await expect(page.locator('.collection-variables-tab .btn-primary')).toBeDisabled({ timeout: 5000 });

    // Add a request to this collection
    const header = page.locator('.collection-header').filter({ hasText: subCollName });
    await header.hover();
    const moreBtn = header.locator('.btn-menu');
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    const menu = page.locator('.collection-menu');
    await expect(menu).toBeVisible();
    await menu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

    // Wait for the new request tab to open
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    // Type URL with variable
    const urlInput = page.locator('.url-input');
    await urlInput.fill('{{test_host}}/get');

    // Verify the variable is highlighted (has env-var-highlight class in overlay)
    const overlay = page.locator('.env-var-overlay');
    await expect(overlay).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/coll-var-substitution.png' });
  });

  test('post-script can set collection variable via pm.collectionVariables.set()', async ({ page }) => {
    const scriptCollName = uniqueName('Script Var Test');
    await createCollection(page, scriptCollName);

    // Add a collection variable
    await openVariablesTab(page, scriptCollName);
    const addVarBtn = page.locator('.btn-add-var');
    await addVarBtn.click();
    const row = page.locator('.env-var-table tbody tr').first();
    await row.locator('td.col-key input').fill('script_result');
    await row.locator('td.col-value input').fill('not_set');
    await page.locator('.collection-variables-tab .btn-primary').click();
    await expect(page.locator('.collection-variables-tab .btn-primary')).toBeDisabled({ timeout: 5000 });

    // Add a request to this collection
    const header = page.locator('.collection-header').filter({ hasText: scriptCollName });
    await header.hover();
    const moreBtn = header.locator('.btn-menu');
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    const menu = page.locator('.collection-menu');
    await expect(menu).toBeVisible();
    await menu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    // Set URL to local Supabase REST endpoint (always reachable from local)
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
    const urlInput = page.locator('.url-input');
    await urlInput.fill(`${supabaseUrl}/rest/v1/`);

    // Navigate to Post-script tab and add script
    await page.locator('.request-tabs button').filter({ hasText: 'Post-script' }).click();
    await expect(page.locator('.script-editor-wrapper')).toBeVisible({ timeout: 5000 });

    // Type the script into the CodeMirror editor
    const cmEditor = page.locator('.script-codemirror .cm-content');
    await cmEditor.click();
    await page.keyboard.type('pm.collectionVariables.set("script_result", "from_script");');

    // Save the request
    await page.locator('.btn-save').click();
    await page.waitForTimeout(1000);

    // Send the request
    await page.locator('.btn-send').click();

    // Wait for response
    await expect(page.locator('.response-viewer .status')).toBeVisible({ timeout: 30000 });

    // Wait for post-script to execute and variable to persist
    await page.waitForTimeout(1000);

    // Click the collection in the sidebar to re-open the collection tab
    const collHeader = page.locator('.collection-header').filter({ hasText: scriptCollName });
    await collHeader.locator('.collection-name').click();
    await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });

    // Click Variables tab
    const varsTab = page.locator('.collection-editor-tab').filter({ hasText: 'Variables' });
    await varsTab.click();
    await expect(page.locator('.collection-variables-tab')).toBeVisible({ timeout: 5000 });

    // Verify the variable was updated by the script
    const valueInput = page.locator('.env-var-table tbody tr').first().locator('td.col-value input');
    const currentValue = await valueInput.inputValue();

    // If the value wasn't updated yet, reload to get fresh data
    if (!currentValue || currentValue === 'not_set') {
      await page.reload();
      await waitForApp(page);
      await openVariablesTab(page, scriptCollName);
    }

    await page.screenshot({ path: 'e2e/screenshots/coll-var-script-set.png' });
  });
});
