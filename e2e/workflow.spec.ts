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

async function createWorkflowInCollection(page, collectionName: string) {
  const header = page.locator('.collection-header').filter({ hasText: collectionName });
  await header.hover();
  const moreBtn = header.locator('.btn-menu');
  await expect(moreBtn).toBeVisible();
  await moreBtn.click();
  const menu = page.locator('.collection-menu');
  await expect(menu).toBeVisible();
  await menu.locator('.request-menu-item').filter({ hasText: 'Add Workflow' }).click();
  await expect(page.locator('.workflow-editor')).toBeVisible({ timeout: 5000 });
}

test.describe('Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('user can create a workflow from collection context menu', async ({ page }) => {
    const name = uniqueName('WF Create Test');
    await createCollection(page, name);
    await createWorkflowInCollection(page, name);

    // Verify workflow appears in sidebar under the collection
    await expect(page.locator('.sidebar-workflow-item')).toBeVisible({ timeout: 5000 });

    // Verify WF badge in tab bar
    await expect(page.locator('.tab-workflow-badge')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/workflow-created.png' });
  });

  test('user can see workflow with empty state', async ({ page }) => {
    const name = uniqueName('WF Empty Test');
    await createCollection(page, name);
    await createWorkflowInCollection(page, name);

    // Verify empty state message
    await expect(page.locator('.workflow-empty')).toBeVisible();
    await expect(page.locator('.workflow-empty')).toContainText('Drag requests');

    // Verify Run Flow button is disabled
    await expect(page.locator('.workflow-controls .btn-primary')).toBeDisabled();

    // Verify report panel exists with empty state
    await expect(page.locator('.response-toolbar')).toBeVisible();
    await expect(page.locator('.response-viewer.empty')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/workflow-empty.png' });
  });

  test('workflow report and console tabs exist', async ({ page }) => {
    const name = uniqueName('WF Tabs Test');
    await createCollection(page, name);
    await createWorkflowInCollection(page, name);

    // Verify Report tab is active by default
    const reportTab = page.locator('.response-tabs button').filter({ hasText: 'Report' });
    await expect(reportTab).toBeVisible();
    await expect(reportTab).toHaveClass(/active/);

    // Click Console tab
    const consoleTab = page.locator('.response-tabs button').filter({ hasText: 'Console' });
    await expect(consoleTab).toBeVisible();
    await consoleTab.click();

    // Verify Console content shows
    await expect(page.locator('.workflow-console')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/workflow-report-console.png' });
  });

  test('workflow sidebar item shows inline actions on hover', async ({ page }) => {
    const name = uniqueName('WF Actions Test');
    await createCollection(page, name);
    await createWorkflowInCollection(page, name);

    // Hover workflow item in sidebar
    const item = page.locator('.sidebar-workflow-item').first();
    await expect(item).toBeVisible();
    await item.hover();

    // Verify inline action buttons appear
    const actions = item.locator('.workflow-item-actions');
    await expect(actions).toBeVisible();

    // Should have play, edit, copy, delete buttons
    const buttons = actions.locator('.btn-icon');
    await expect(buttons).toHaveCount(4);

    await page.screenshot({ path: 'e2e/screenshots/workflow-sidebar-actions.png' });
  });
});
