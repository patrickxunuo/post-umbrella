import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cleanupTestCollections } from './helpers/cleanup';

// Generate unique names for each test run
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'imports');

function loadFixture(fileName: string): any {
  const raw = readFileSync(join(FIXTURES_DIR, fileName), 'utf-8');
  return JSON.parse(raw);
}

async function waitForApp(page: Page) {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
}

/**
 * Drive the new ImportModal end-to-end (format pick → file → preview → commit)
 * with a Postman v2.1 fixture.
 */
async function importPostmanFile(page: Page, collectionJsonObj: any, fileName = 'test-collection.json') {
  const importTrigger = page.locator('.import-dropdown-trigger');
  await expect(importTrigger).toBeVisible();
  await importTrigger.click();

  const importMenu = page.locator('.import-dropdown-menu');
  await expect(importMenu).toBeVisible();
  await importMenu.locator('.import-dropdown-item').filter({ hasText: 'Import Collection' }).click();

  const modal = page.locator('[data-testid="import-modal"]');
  await expect(modal).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="import-format-postman-v2.1"]').click();
  await modal.locator('button.btn-primary').filter({ hasText: /Next/i }).click();

  await page.locator('[data-testid="import-file-input"]').setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(collectionJsonObj)),
  });
  await modal.locator('button.btn-primary').filter({ hasText: /Preview/i }).click();

  await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="import-commit"]').click();
}

/**
 * Expand a collection (root or nested folder) in the sidebar by clicking its arrow.
 * If the arrow is already in the expanded state (ChevronDown), this clicks it again,
 * so callers should call once when the node is collapsed.
 */
async function expandCollectionHeader(page: Page, headerLocator: ReturnType<Page['locator']>) {
  const arrow = headerLocator.locator('.collection-arrow');
  if (!(await arrow.isVisible().catch(() => false))) return;
  // lucide-react renders ChevronDown when expanded, ChevronRight when collapsed.
  const svgClass = (await arrow.locator('svg').getAttribute('class').catch(() => '')) || '';
  if (/chevron-down/i.test(svgClass)) return; // already expanded
  await arrow.click({ force: true });
  await page.waitForTimeout(250);
}

test.describe('Postman Import/Export Round-Trip', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  // ---------- Scenario 1: roundtrip-postman-v2.1 ----------
  test('roundtrip-postman-v2.1 — fixture imports with auth, scripts, variables, folders intact and exports back', async ({ page }) => {
    const fixture = loadFixture('postman-v2.1-roundtrip.json');
    // Deep-clone and suffix the collection name with a timestamp so parallel test runs don't collide.
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = `${cloned.info.name} ${timestamp}`;
    cloned.info.name = rootName;

    await importPostmanFile(page, cloned, 'postman-v2.1-roundtrip.json');

    // The fixture has an APIKey request that triggers the "Import Warnings" modal.
    // Dismiss it before interacting with the sidebar.
    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 30000 });
    await page.locator('.confirm-btn-confirm').click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    // Wait for the import to finish and the collection to appear in the sidebar.
    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });

    // --- Verify root collection Variables tab has api_key and base_url ---
    await rootHeader.locator('.collection-name').click();
    await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });
    await page.locator('.collection-editor-tab').filter({ hasText: 'Variables' }).click();
    await expect(page.locator('.collection-variables-tab')).toBeVisible({ timeout: 5000 });

    const varsTable = page.locator('.collection-variables-tab .env-var-table tbody tr');
    // Collect {key, value} for each row
    const rowCount = await varsTable.count();
    const rows: Array<{ key: string; value: string }> = [];
    for (let i = 0; i < rowCount; i++) {
      const row = varsTable.nth(i);
      const k = await row.locator('td.col-key input').inputValue().catch(() => '');
      const v = await row.locator('td.col-value input').inputValue().catch(() => '');
      if (k) rows.push({ key: k, value: v });
    }
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'api_key', value: 'abc123' }),
        expect.objectContaining({ key: 'base_url', value: 'https://httpbin.org' }),
      ])
    );

    // --- Expand the root collection and "Folder A" ---
    // Root should be collapsed after opening its tab — click the arrow to expand.
    await expandCollectionHeader(page, rootHeader);

    const folderA = page.locator('.collection-header').filter({ hasText: 'Folder A' });
    await expect(folderA).toBeVisible({ timeout: 5000 });
    await expandCollectionHeader(page, folderA);

    // --- Verify Bearer Request: auth_type=bearer with token 'req-token' ---
    const bearerRequestItem = page.locator('.request-item').filter({ hasText: 'Bearer Request' });
    await expect(bearerRequestItem).toBeVisible({ timeout: 5000 });
    await bearerRequestItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();
    const bearerRadio = page.locator('.auth-type-selector label').filter({ hasText: 'Bearer Token' });
    await expect(bearerRadio.locator('input[type="radio"]')).toBeChecked();
    await expect(page.locator('.auth-token-field')).toHaveValue('req-token');

    // --- Expand the SubFolder and verify Inherit Request ---
    const subFolder = page.locator('.collection-header').filter({ hasText: 'SubFolder' });
    await expect(subFolder).toBeVisible({ timeout: 5000 });
    await expandCollectionHeader(page, subFolder);

    const inheritRequestItem = page.locator('.request-item').filter({ hasText: 'Inherit Request' });
    await expect(inheritRequestItem).toBeVisible({ timeout: 5000 });
    await inheritRequestItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
    await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();
    const inheritRadio = page.locator('.auth-type-selector label').filter({ hasText: 'Inherit from Parent' });
    await expect(inheritRadio.locator('input[type="radio"]')).toBeChecked();

    // --- Verify NoAuth Request ---
    const noAuthRequestItem = page.locator('.request-item').filter({ hasText: 'NoAuth Request' });
    await expect(noAuthRequestItem).toBeVisible({ timeout: 5000 });
    await noAuthRequestItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
    await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();
    const noAuthRadio = page.locator('.auth-type-selector label').filter({ hasText: 'No Auth' });
    await expect(noAuthRadio.locator('input[type="radio"]')).toBeChecked();

    // --- Verify Scripted Request has pre/post-script populated ---
    const scriptedRequestItem = page.locator('.request-item').filter({ hasText: 'Scripted Request' });
    await expect(scriptedRequestItem).toBeVisible({ timeout: 5000 });
    await scriptedRequestItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    await page.locator('.request-tabs button').filter({ hasText: 'Pre-script' }).click();
    await expect(page.locator('.script-editor-wrapper')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.script-codemirror .cm-content')).toContainText('req pre');

    await page.locator('.request-tabs button').filter({ hasText: 'Post-script' }).click();
    await expect(page.locator('.script-editor-wrapper')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.script-codemirror .cm-content')).toContainText('req post');

    // --- Trigger Export and capture the downloaded JSON ---
    // Click the root header's menu to open the collection menu.
    await rootHeader.hover();
    const moreBtn = rootHeader.locator('.btn-menu');
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    const menu = page.locator('.collection-menu');
    await expect(menu).toBeVisible();

    // Capture the export download. Playwright runs in browser mode (not Tauri),
    // so the browser-path download handler is deterministic here — failure to
    // capture should fail the test rather than silently skip the assertions.
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await menu.locator('.request-menu-item').filter({ hasText: 'Export' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    expect(stream).toBeTruthy();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) chunks.push(Buffer.from(chunk));
    const exportedJson: any = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

    {
      // --- Structural equality on key fields, allowing UUID differences ---
      // Root auth
      expect(exportedJson.auth).toMatchObject({
        type: 'bearer',
        bearer: expect.arrayContaining([
          expect.objectContaining({ key: 'token', value: 'root-token' }),
        ]),
      });

      // Root events (pre & post)
      expect(Array.isArray(exportedJson.event)).toBe(true);
      const listeners = (exportedJson.event || []).map((e: any) => e.listen);
      expect(listeners).toEqual(expect.arrayContaining(['prerequest', 'test']));

      // Root variables
      expect(Array.isArray(exportedJson.variable)).toBe(true);
      const varKeys = (exportedJson.variable || []).map((v: any) => v.key);
      expect(varKeys).toEqual(expect.arrayContaining(['api_key', 'base_url']));
      const apiKeyVar = exportedJson.variable.find((v: any) => v.key === 'api_key');
      expect(apiKeyVar).toMatchObject({ value: 'abc123' });

      // Folder hierarchy: Folder A with SubFolder + Bearer Request
      const items = exportedJson.item || [];
      const folderAItem = items.find((i: any) => i.name === 'Folder A');
      expect(folderAItem).toBeTruthy();
      expect(Array.isArray(folderAItem.item)).toBe(true);
      const bearerReqItem = folderAItem.item.find((i: any) => i.name === 'Bearer Request');
      expect(bearerReqItem).toBeTruthy();
      expect(bearerReqItem.request?.auth).toMatchObject({
        type: 'bearer',
        bearer: expect.arrayContaining([
          expect.objectContaining({ key: 'token', value: 'req-token' }),
        ]),
      });
      const subFolderItem = folderAItem.item.find((i: any) => i.name === 'SubFolder');
      expect(subFolderItem).toBeTruthy();
      const inheritItem = (subFolderItem.item || []).find((i: any) => i.name === 'Inherit Request');
      expect(inheritItem).toBeTruthy();
      // Inherit request should NOT have an auth field (or it should be null/undefined — Postman's inherit marker)
      expect(inheritItem.request?.auth == null).toBeTruthy();

      // Root-level Scripted Request events
      const scriptedItem = items.find((i: any) => i.name === 'Scripted Request');
      expect(scriptedItem).toBeTruthy();
      expect(Array.isArray(scriptedItem.event)).toBe(true);
      const scriptedListeners = scriptedItem.event.map((e: any) => e.listen);
      expect(scriptedListeners).toEqual(expect.arrayContaining(['prerequest', 'test']));
    }

    await page.screenshot({ path: 'e2e/screenshots/import-roundtrip.png' });
  });

  // ---------- Scenario 2: import-warnings-surface ----------
  test('import-warnings-surface — basic and oauth2 auth produce warnings toast + modal', async ({ page }) => {
    const fixture = loadFixture('postman-v2.1-unsupported-auth.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = `${cloned.info.name} ${timestamp}-warn`;
    cloned.info.name = rootName;

    await importPostmanFile(page, cloned, 'postman-v2.1-unsupported-auth.json');

    // Warnings modal opens directly (no intermediate toast)
    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 15000 });
    const listText = (await warningsList.textContent()) || '';
    expect(listText.toLowerCase()).toContain('basic');
    expect(listText.toLowerCase()).toContain('oauth');

    // Dismiss
    const confirmBtn = page.locator('.confirm-btn-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    // Collection should now be visible in sidebar
    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: 'e2e/screenshots/import-warnings.png' });
  });

  // ---------- Scenario 3: import-apikey-header ----------
  test('import-apikey-header — apikey (in=header) is injected as a request header with a warning', async ({ page }) => {
    const fixture = loadFixture('postman-v2.1-roundtrip.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = `${cloned.info.name} ${timestamp}-apikey`;
    cloned.info.name = rootName;

    await importPostmanFile(page, cloned, 'postman-v2.1-roundtrip.json');

    // Warnings modal opens directly with the API Key advisory
    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 15000 });
    const listText = (await warningsList.textContent()) || '';
    expect(listText.toLowerCase()).toContain('api key');

    // Close modal
    const confirmBtn = page.locator('.confirm-btn-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    // Now find the imported collection in the sidebar
    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 15000 });

    // Expand root, open APIKey Request, check headers
    await expandCollectionHeader(page, rootHeader);

    const apiKeyRequestItem = page.locator('.request-item').filter({ hasText: 'APIKey Request' });
    await expect(apiKeyRequestItem).toBeVisible({ timeout: 5000 });
    await apiKeyRequestItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    await page.locator('.request-tabs button').filter({ hasText: 'Headers' }).click();
    const headersEditor = page.locator('.headers-editor');
    await expect(headersEditor).toBeVisible({ timeout: 5000 });

    // Find the row whose key input contains 'X-API-Key' and assert its value
    const headerRows = headersEditor.locator('tbody tr');
    const count = await headerRows.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const row = headerRows.nth(i);
      const keyInput = row.locator('td input[type="text"]').first();
      const key = await keyInput.inputValue().catch(() => '');
      if (key === 'X-API-Key') {
        // Value input is inside an EnvVariableInput — pick the visible text input in this row.
        const valueInputs = row.locator('input[type="text"], input:not([type])');
        const n = await valueInputs.count();
        for (let j = 0; j < n; j++) {
          const v = await valueInputs.nth(j).inputValue().catch(() => '');
          if (v === 'secret123') {
            found = true;
            break;
          }
        }
        break;
      }
    }
    expect(found).toBe(true);

    await page.screenshot({ path: 'e2e/screenshots/import-apikey-header.png' });
  });
});
