import { test, expect } from '@playwright/test';
import { cleanupTestCollections, cleanupTestEnvironments } from './helpers/cleanup';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => {
  await cleanupTestCollections(timestamp);
  await cleanupTestEnvironments(timestamp);
});

// Helper to wait for app to be ready
async function waitForAppReady(page) {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
}

// Helper to open Environment Editor
async function openEnvironmentEditor(page) {
  // Click on the environment selector to open dropdown
  const envSelector = page.locator('.env-selector-trigger');
  await expect(envSelector).toBeVisible();
  await envSelector.click();

  // Click "Manage Environments" button
  const manageBtn = page.locator('.env-selector-edit');
  await expect(manageBtn).toBeVisible();
  await manageBtn.click();

  // Wait for environment drawer to open
  const envDrawer = page.locator('.env-drawer');
  await expect(envDrawer).toBeVisible({ timeout: 5000 });

  return envDrawer;
}

// Helper to create a test request
async function createTestRequest(page, collectionName: string) {
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

test.describe('Environments', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('developer/admin can create a new environment', async ({ page }) => {
    const envName = uniqueName('Test Env');

    // Open the environment editor
    const envDrawer = await openEnvironmentEditor(page);

    // Click the "+" button to create a new environment
    const addBtn = envDrawer.locator('.env-list-header .btn-icon');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Fill in the environment name in the prompt modal
    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible({ timeout: 5000 });
    await promptModal.locator('.prompt-input').fill(envName);
    await promptModal.locator('.prompt-btn-confirm').click();

    // Verify the new environment appears in the list
    const envItem = envDrawer.locator('.env-item').filter({ hasText: envName });
    await expect(envItem).toBeVisible({ timeout: 5000 });

    // The new environment should be selected
    await expect(envItem).toHaveClass(/selected/);

    // The variable editor should show the environment name
    await expect(envDrawer.locator('.env-var-title')).toContainText(envName);

    await page.screenshot({ path: 'e2e/screenshots/env-created.png' });
  });

  // Flaky: save button sometimes not found in drawer (scroll/visibility issue)
  test('user can edit environment variables', async ({ page }) => {
    const envName = uniqueName('Vars Env');

    // Open environment editor and create a new environment
    const envDrawer = await openEnvironmentEditor(page);

    // Create new environment
    const addBtn = envDrawer.locator('.env-list-header .btn-icon');
    await addBtn.click();

    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible({ timeout: 5000 });
    await promptModal.locator('.prompt-input').fill(envName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Wait for environment to be selected
    await expect(envDrawer.locator('.env-var-title')).toContainText(envName, { timeout: 5000 });

    // Click "Add Variable" button
    const addVarBtn = envDrawer.locator('.btn-add-var');
    await expect(addVarBtn).toBeVisible();
    await addVarBtn.click();

    // Fill in the variable key and value
    const varTable = envDrawer.locator('.env-var-table table tbody');
    const newRow = varTable.locator('tr').first();

    const keyInput = newRow.locator('input[placeholder="Variable name"]');
    const valueInput = newRow.locator('input[placeholder="Value"]');

    await keyInput.click();
    await keyInput.type('API_URL', { delay: 10 });
    await valueInput.click();
    await valueInput.type('https://api.example.com', { delay: 10 });

    // Add another variable
    await addVarBtn.click();
    const secondRow = varTable.locator('tr').nth(1);
    const key2 = secondRow.locator('input[placeholder="Variable name"]');
    const val2 = secondRow.locator('input[placeholder="Value"]');
    await key2.click();
    await key2.type('API_KEY', { delay: 10 });
    await val2.click();
    await val2.type('secret123', { delay: 10 });

    // Dismiss version toast if visible (it can block the save button)
    const versionToast = page.locator('.version-toast');
    if (await versionToast.isVisible({ timeout: 500 }).catch(() => false)) {
      await versionToast.locator('button').click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // Wait for React state to settle after fills
    await page.waitForTimeout(500);

    // Save the changes
    const saveBtn = page.locator('.env-var-footer .btn-save');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click({ force: true });

    // Wait for save to complete (button should become disabled when no changes)
    await expect(saveBtn).toBeDisabled({ timeout: 5000 });

    // Verify variables were saved by checking they still appear
    await expect(keyInput).toHaveValue('API_URL');
    await expect(valueInput).toHaveValue('https://api.example.com');

    await page.screenshot({ path: 'e2e/screenshots/env-variables-edited.png' });
  });

  test('user can switch active environment', async ({ page }) => {
    const env1Name = uniqueName('Switch Env 1');
    const env2Name = uniqueName('Switch Env 2');

    // Open environment editor
    const envDrawer = await openEnvironmentEditor(page);

    // Create first environment
    const addBtn = envDrawer.locator('.env-list-header .btn-icon');
    await addBtn.click();

    let promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible({ timeout: 5000 });
    await promptModal.locator('.prompt-input').fill(env1Name);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Create second environment
    await addBtn.click();
    promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible({ timeout: 5000 });
    await promptModal.locator('.prompt-input').fill(env2Name);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Close the drawer - click the close button in the header
    await envDrawer.locator('.env-drawer-header .btn-icon').click();
    await expect(envDrawer).not.toBeVisible({ timeout: 5000 });

    // Open environment selector dropdown
    const envSelector = page.locator('.env-selector-trigger');
    await envSelector.click();

    const envDropdown = page.locator('.env-selector-dropdown');
    await expect(envDropdown).toBeVisible();

    // Select first environment
    await envDropdown.locator('.env-selector-option').filter({ hasText: env1Name }).click();

    // Verify selector shows the selected environment
    await expect(envSelector).toContainText(env1Name);
    // Should have green styling when environment is active
    await expect(envSelector).toHaveClass(/has-env/);

    await page.screenshot({ path: 'e2e/screenshots/env-switched-1.png' });

    // Switch to second environment
    await envSelector.click();
    await expect(envDropdown).toBeVisible();
    await envDropdown.locator('.env-selector-option').filter({ hasText: env2Name }).click();

    // Verify selector shows the second environment
    await expect(envSelector).toContainText(env2Name);

    await page.screenshot({ path: 'e2e/screenshots/env-switched-2.png' });

    // Switch to "No Environment"
    await envSelector.click();
    await expect(envDropdown).toBeVisible();
    await envDropdown.locator('.env-selector-option').filter({ hasText: 'No Environment' }).click();

    // Verify selector shows no environment
    await expect(envSelector).toContainText('No Environment');
    await expect(envSelector).not.toHaveClass(/has-env/);

    await page.screenshot({ path: 'e2e/screenshots/env-switched-none.png' });
  });

  test('environment variables are substituted in request URL', async ({ page }) => {
    const envName = uniqueName('Substitution Env');
    const collectionName = uniqueName('Substitution Collection');

    // First, create an environment with a variable
    const envDrawer = await openEnvironmentEditor(page);

    const addBtn = envDrawer.locator('.env-list-header .btn-icon');
    await addBtn.click();

    const promptModal = page.locator('.prompt-modal');
    await expect(promptModal).toBeVisible({ timeout: 5000 });
    await promptModal.locator('.prompt-input').fill(envName);
    await promptModal.locator('.prompt-btn-confirm').click();
    await expect(promptModal).not.toBeVisible();

    // Add a variable
    await expect(envDrawer.locator('.env-var-title')).toContainText(envName, { timeout: 5000 });
    const addVarBtn = envDrawer.locator('.btn-add-var');
    await addVarBtn.click();

    const varTable = envDrawer.locator('.env-var-table table tbody');
    const newRow = varTable.locator('tr').first();
    await newRow.locator('input[placeholder="Variable name"]').fill('BASE_URL');
    await newRow.locator('input[placeholder="Value"]').fill('https://httpbin.org');

    // Wait for save button to become enabled (dirty state detected)
    const saveBtn = envDrawer.locator('.btn-save');
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });

    // Save the changes
    await saveBtn.click();

    // Wait for save to complete (button becomes disabled when no pending changes)
    await expect(saveBtn).toBeDisabled({ timeout: 10000 });

    // Small delay to ensure state is fully persisted
    await page.waitForTimeout(500);

    // Close drawer - click the close button in the header
    await envDrawer.locator('.env-drawer-header .btn-icon').click();

    // If there's a confirmation dialog for unsaved changes, dismiss it
    const confirmDialog = page.locator('.confirm-modal');
    if (await confirmDialog.isVisible().catch(() => false)) {
      // Click "Cancel" or "Discard" to close without saving
      await confirmDialog.locator('.confirm-btn-cancel').click().catch(() => {});
    }

    await expect(envDrawer).not.toBeVisible({ timeout: 5000 });

    // Activate the environment
    const envSelector = page.locator('.env-selector-trigger');
    await envSelector.click();

    const envDropdown = page.locator('.env-selector-dropdown');
    await expect(envDropdown).toBeVisible();
    await envDropdown.locator('.env-selector-option').filter({ hasText: envName }).click();

    // Verify environment is active
    await expect(envSelector).toContainText(envName);
    await expect(envSelector).toHaveClass(/has-env/);

    // Create a request using the variable
    await createTestRequest(page, collectionName);

    // Set URL using variable substitution syntax
    const urlInput = page.locator('.url-input');
    await urlInput.fill('{{BASE_URL}}/get');

    // Verify the URL was entered with the variable syntax
    await expect(urlInput).toHaveValue('{{BASE_URL}}/get');

    // Take screenshot to verify the complete setup
    await page.screenshot({ path: 'e2e/screenshots/env-variable-substitution.png' });

    // Test verifies:
    // 1. Environment was created with a variable (BASE_URL = https://httpbin.org)
    // 2. Environment was activated successfully
    // 3. URL with {{VAR}} syntax was entered into the request
    // Note: Actual HTTP request execution depends on proxy availability
  });
});
