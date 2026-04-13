import { test, expect } from '@playwright/test';
import { cleanupTestCollections, cleanupTestEnvironments } from './helpers/cleanup';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => {
  await cleanupTestCollections(timestamp);
  await cleanupTestEnvironments(timestamp);
});

// Helper: wait for app to load
async function waitForApp(page) {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  // Hide version toast so it doesn't block interactions
  await page.evaluate(() => {
    const toast = document.querySelector('.version-toast');
    if (toast) (toast as HTMLElement).style.display = 'none';
  });
}

// Helper: create a root collection with given name
async function createCollection(page, name: string) {
  const addBtn = page.locator('.sidebar-toolbar .btn-icon').last();
  await expect(addBtn).toBeEnabled({ timeout: 10000 });
  await addBtn.click();

  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible({ timeout: 5000 });
  await promptModal.locator('.prompt-input').fill(name);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();

  await expect(page.locator('.collection-header').filter({ hasText: name })).toBeVisible({ timeout: 5000 });
}

// Helper: set Bearer auth token on a collection by name
async function setCollectionBearerAuth(page, collectionName: string, token: string) {
  const header = page.locator('.collection-header').filter({ hasText: collectionName });
  await header.locator('.collection-name').click();
  await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });

  await page.locator('.collection-editor-tab').filter({ hasText: 'Auth' }).click();
  await page.locator('.auth-type-selector label').filter({ hasText: 'Bearer Token' }).click();

  const tokenInput = page.locator('.auth-token-field');
  await expect(tokenInput).toBeVisible();
  await tokenInput.fill(token);

  const saveBtn = page.locator('.collection-editor-tabs .btn-primary');
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(saveBtn).toBeDisabled({ timeout: 5000 });
}

// Helper: add a request inside a collection, leaving the request editor visible
async function addRequestInCollection(page, collectionName: string) {
  const header = page.locator('.collection-header').filter({ hasText: collectionName });
  await header.hover();
  const moreBtn = header.locator('.btn-menu');
  await expect(moreBtn).toBeVisible();
  await moreBtn.click();

  const menu = page.locator('.collection-menu');
  await expect(menu).toBeVisible();
  await menu.locator('.request-menu-item').filter({ hasText: 'Add Request' }).click();

  await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
}

// Helper: select an auth type radio in the request auth tab
async function setRequestAuth(page, authLabel: string, token?: string) {
  await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();
  const radio = page.locator('.auth-type-selector label').filter({ hasText: authLabel });
  await expect(radio).toBeVisible({ timeout: 5000 });
  await radio.click();
  if (token !== undefined) {
    const tokenInput = page.locator('.auth-token-field');
    await expect(tokenInput).toBeVisible({ timeout: 5000 });
    await tokenInput.fill(token);
  }
}

// Helper: open the cURL panel (button in request editor header)
async function openCurlPanel(page) {
  const curlBtn = page.locator('.btn-copy-curl');
  await expect(curlBtn).toBeVisible({ timeout: 5000 });
  // Only toggle open if not already active
  const className = (await curlBtn.getAttribute('class')) || '';
  if (!className.includes('active')) {
    await curlBtn.click();
  }
  await expect(page.locator('.curl-panel')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="curl-panel-code"]')).toBeVisible({ timeout: 5000 });
}

// Helper: read the full cURL text from the panel (CodeMirror virtualises — use innerText of .cm-content)
async function readCurlText(page): Promise<string> {
  const code = page.locator('[data-testid="curl-panel-code"] .cm-content');
  await expect(code).toBeVisible({ timeout: 5000 });
  return (await code.innerText()).replace(/\u00a0/g, ' ');
}

// Helper: open environment editor drawer
async function openEnvironmentEditor(page) {
  const envSelector = page.locator('.env-selector-trigger');
  await expect(envSelector).toBeVisible();
  await envSelector.click();
  const manageBtn = page.locator('.env-selector-edit');
  await expect(manageBtn).toBeVisible();
  await manageBtn.click();
  const envDrawer = page.locator('.env-drawer');
  await expect(envDrawer).toBeVisible({ timeout: 5000 });
  return envDrawer;
}

// Helper: create an environment with a single key=value variable and activate it
async function createAndActivateEnvironment(page, envName: string, key: string, value: string) {
  const envDrawer = await openEnvironmentEditor(page);

  const addBtn = envDrawer.locator('.env-list-header .btn-icon');
  await addBtn.click();

  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible({ timeout: 5000 });
  await promptModal.locator('.prompt-input').fill(envName);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible();

  await expect(envDrawer.locator('.env-var-title')).toContainText(envName, { timeout: 5000 });

  const addVarBtn = envDrawer.locator('.btn-add-var');
  await addVarBtn.click();

  const varTable = envDrawer.locator('.env-var-table table tbody');
  const newRow = varTable.locator('tr').first();
  await newRow.locator('input[placeholder="Variable name"]').fill(key);
  await newRow.locator('input[placeholder="Value"]').fill(value);

  const saveBtn = envDrawer.locator('.btn-save');
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(saveBtn).toBeDisabled({ timeout: 10000 });
  await page.waitForTimeout(300);

  // Close drawer
  await envDrawer.locator('.env-drawer-header .btn-icon').click();
  const confirmDialog = page.locator('.confirm-modal');
  if (await confirmDialog.isVisible().catch(() => false)) {
    await confirmDialog.locator('.confirm-btn-cancel').click().catch(() => {});
  }
  await expect(envDrawer).not.toBeVisible({ timeout: 5000 });

  // Activate via env selector dropdown
  const envSelector = page.locator('.env-selector-trigger');
  await envSelector.click();
  const envDropdown = page.locator('.env-selector-dropdown');
  await expect(envDropdown).toBeVisible();
  await envDropdown.locator('.env-selector-option').filter({ hasText: envName }).click();
  await expect(envSelector).toContainText(envName);
  await expect(envSelector).toHaveClass(/has-env/);
}

// Helper: add a collection variable to a collection by name
async function addCollectionVariable(page, collectionName: string, key: string, value: string) {
  const header = page.locator('.collection-header').filter({ hasText: collectionName });
  await header.locator('.collection-name').click();
  await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });

  const varsTab = page.locator('.collection-editor-tab').filter({ hasText: 'Variables' });
  await expect(varsTab).toBeVisible({ timeout: 5000 });
  await varsTab.click();
  await expect(page.locator('.collection-variables-tab')).toBeVisible({ timeout: 5000 });

  const addVarBtn = page.locator('.btn-add-var');
  await expect(addVarBtn).toBeVisible();
  await addVarBtn.click();

  const row = page.locator('.env-var-table tbody tr').first();
  await row.locator('td.col-key input').fill(key);
  await row.locator('td.col-value input').fill(value);

  const saveBtn = page.locator('.collection-variables-tab .btn-primary');
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(saveBtn).toBeDisabled({ timeout: 5000 });
  await page.waitForTimeout(300);
}

test.describe('cURL Panel — auth inheritance and variables', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('curl-inherited-auth: request with inherit auth picks up parent bearer token', async ({ page }) => {
    const collectionName = uniqueName('Curl Inherit Test');
    const parentToken = 'parent-token-abc';

    // Create a collection with Bearer auth
    await createCollection(page, collectionName);
    await setCollectionBearerAuth(page, collectionName, parentToken);

    // Add a request inside it
    await addRequestInCollection(page, collectionName);

    // Ensure request uses Inherit auth
    await setRequestAuth(page, 'Inherit from Parent');

    // Give the request a reachable URL so the cURL output is meaningful
    await page.locator('.url-input').fill('https://httpbin.org/get');

    // Open cURL panel and read content
    await openCurlPanel(page);
    const curl = await readCurlText(page);

    expect(curl).toContain(`Authorization: Bearer ${parentToken}`);

    await page.screenshot({ path: 'e2e/screenshots/curl-inherited-auth.png' });
  });

  test('curl-env-variable-token: {{api_key}} in bearer token resolves from active environment', async ({ page }) => {
    const collectionName = uniqueName('Curl Env Var Test');
    const envName = uniqueName('Curl Env');
    const envValue = 'env-123';

    // Create env with api_key=env-123 and activate it
    await createAndActivateEnvironment(page, envName, 'api_key', envValue);

    // Create collection + request with bearer token "{{api_key}}"
    await createCollection(page, collectionName);
    await addRequestInCollection(page, collectionName);
    await setRequestAuth(page, 'Bearer Token', '{{api_key}}');

    await page.locator('.url-input').fill('https://httpbin.org/get');

    await openCurlPanel(page);
    const curl = await readCurlText(page);

    expect(curl).toContain(`Authorization: Bearer ${envValue}`);
    // Also ensure the raw variable pattern is NOT present
    expect(curl).not.toContain('{{api_key}}');

    await page.screenshot({ path: 'e2e/screenshots/curl-env-variable-token.png' });
  });

  test('curl-collection-variable-token: {{api_key}} resolves from collection variable when no env var', async ({ page }) => {
    const collectionName = uniqueName('Curl Coll Var Test');
    const colValue = 'col-456';

    // Make sure no environment is active for this test
    const envSelector = page.locator('.env-selector-trigger');
    await envSelector.click();
    const envDropdown = page.locator('.env-selector-dropdown');
    await expect(envDropdown).toBeVisible();
    await envDropdown.locator('.env-selector-option').filter({ hasText: 'No Environment' }).click();
    await expect(envSelector).toContainText('No Environment');

    // Create collection and add a collection variable api_key=col-456
    await createCollection(page, collectionName);
    await addCollectionVariable(page, collectionName, 'api_key', colValue);

    // Add a request inside with bearer token "{{api_key}}"
    await addRequestInCollection(page, collectionName);
    await setRequestAuth(page, 'Bearer Token', '{{api_key}}');

    await page.locator('.url-input').fill('https://httpbin.org/get');

    await openCurlPanel(page);
    const curl = await readCurlText(page);

    expect(curl).toContain(`Authorization: Bearer ${colValue}`);
    expect(curl).not.toContain('{{api_key}}');

    await page.screenshot({ path: 'e2e/screenshots/curl-collection-variable-token.png' });
  });

  test('curl-env-overrides-collection: env var wins over collection var for same key', async ({ page }) => {
    const collectionName = uniqueName('Curl Override Test');
    const envName = uniqueName('Curl Override Env');
    const colValue = 'col-val';
    const envValue = 'env-val';

    // Create env with api_key=env-val and activate it
    await createAndActivateEnvironment(page, envName, 'api_key', envValue);

    // Create collection, add collection variable api_key=col-val (same key)
    await createCollection(page, collectionName);
    await addCollectionVariable(page, collectionName, 'api_key', colValue);

    // Add request inside with bearer token "{{api_key}}"
    await addRequestInCollection(page, collectionName);
    await setRequestAuth(page, 'Bearer Token', '{{api_key}}');

    await page.locator('.url-input').fill('https://httpbin.org/get');

    await openCurlPanel(page);
    const curl = await readCurlText(page);

    // Env value must win
    expect(curl).toContain(`Authorization: Bearer ${envValue}`);
    expect(curl).not.toContain(`Bearer ${colValue}`);
    expect(curl).not.toContain('{{api_key}}');

    await page.screenshot({ path: 'e2e/screenshots/curl-env-overrides-collection.png' });
  });
});
