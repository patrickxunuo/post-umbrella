import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cleanupTestCollections } from './helpers/cleanup';

// Generate unique names for each test run
const timestamp = Date.now();

test.afterAll(async () => {
  await cleanupTestCollections(timestamp);
});

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
 * Open the new ImportModal via the header Import button.
 */
async function openImportModal(page: Page) {
  const importTrigger = page.locator('.import-dropdown-trigger');
  await expect(importTrigger).toBeVisible();
  await importTrigger.click();

  const importMenu = page.locator('.import-dropdown-menu');
  await expect(importMenu).toBeVisible();

  // The top-level "Import" item opens the ImportModal.
  // "From cURL" remains a separate menu item (regression AC13).
  await importMenu.locator('.import-dropdown-item').filter({ hasText: 'Import Collection' }).click();

  const modal = page.locator('[data-testid="import-modal"]');
  await expect(modal).toBeVisible({ timeout: 10000 });
  return modal;
}

/**
 * Pick a format radio in the modal's format step, then click Next to advance to the file step.
 */
async function pickFormat(page: Page, format: 'postman-v2.1' | 'insomnia-v4' | 'post-umbrella' | 'openapi-3') {
  const radio = page.locator(`[data-testid="import-format-${format}"]`);
  await expect(radio).toBeVisible();
  await radio.click();
  // Advance to the file step
  const nextBtn = page.locator('[data-testid="import-modal"] button.btn-primary').filter({ hasText: /Next/i });
  if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nextBtn.click();
  }
}

/**
 * Upload a fixture object as a JSON file into the modal's hidden file input,
 * then click the Preview button to advance to the preview/error step.
 */
async function uploadFixture(page: Page, jsonObj: any, fileName: string) {
  const input = page.locator('[data-testid="import-file-input"]');
  await input.setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(jsonObj)),
  });
  // Click Preview to run runImport
  const previewBtn = page.locator('[data-testid="import-modal"] button.btn-primary').filter({ hasText: /Preview/i });
  await expect(previewBtn).toBeEnabled({ timeout: 5000 });
  await previewBtn.click();
}

/**
 * Rename an Insomnia workspace resource so the cleanup helper can find and delete it.
 */
function renameInsomniaWorkspace(parsed: any, suffix: string) {
  const ws = (parsed.resources || []).find((r: any) => r._type === 'workspace');
  if (ws) ws.name = `${ws.name} ${suffix}`;
  return ws?.name as string;
}

async function expandCollectionHeader(page: Page, headerLocator: ReturnType<Page['locator']>) {
  const arrow = headerLocator.locator('.collection-arrow');
  if (!(await arrow.isVisible().catch(() => false))) return;
  const svgClass = (await arrow.locator('svg').getAttribute('class').catch(() => '')) || '';
  if (/chevron-down/i.test(svgClass)) return;
  await arrow.click({ force: true });
  await page.waitForTimeout(250);
}

test.describe('Multi-Format Importer (PR #2 of #30)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  // ---------- 1. format-picker-opens ----------
  test('format-picker-opens — Import button opens modal with 4 format options', async ({ page }) => {
    await openImportModal(page);

    // The 4 format options should be visible.
    await expect(page.locator('[data-testid="import-format-postman-v2.1"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-format-insomnia-v4"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-format-post-umbrella"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-format-openapi-3"]')).toBeVisible();
  });

  // ---------- 2. wrong-format-swap ----------
  test('wrong-format-swap — uploading Postman under Insomnia surfaces swap suggestion', async ({ page }) => {
    const fixture = loadFixture('wrong-format-postman-under-insomnia.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = `${cloned.info.name} ${timestamp}`;
    cloned.info.name = rootName;

    await openImportModal(page);
    await pickFormat(page, 'insomnia-v4');
    await uploadFixture(page, cloned, 'wrong-format-postman-under-insomnia.json');

    // Error step should appear with the "switch to postman" swap affordance.
    const errorPanel = page.locator('[data-testid="import-error"]');
    await expect(errorPanel).toBeVisible({ timeout: 10000 });
    const errText = ((await errorPanel.textContent()) || '').toLowerCase();
    // The swap button naming includes "postman" — asserts the modal detected the actual format.
    expect(errText).toMatch(/postman/);

    // Swap button should be present.
    const swapBtn = page.locator('[data-testid="import-switch-format-postman-v2.1"]');
    await expect(swapBtn).toBeVisible();
    await swapBtn.click();

    // Should advance to preview step and let us commit.
    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="import-commit"]').click();

    // Dismiss any warnings modal if it appears.
    const warningsList = page.locator('[data-testid="confirm-list"]');
    if (await warningsList.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('.confirm-btn-confirm').click();
      await expect(warningsList).not.toBeVisible({ timeout: 5000 });
    }

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });
  });

  // ---------- 3. schema-validation-fails-loudly ----------
  test('schema-validation-fails-loudly — malformed Postman shows Ajv errors and does not write', async ({ page }) => {
    const fixture = loadFixture('postman-v2.1-malformed.json');
    const cloned = JSON.parse(JSON.stringify(fixture));

    await openImportModal(page);
    await pickFormat(page, 'postman-v2.1');
    await uploadFixture(page, cloned, 'postman-v2.1-malformed.json');

    const errorPanel = page.locator('[data-testid="import-error"]');
    await expect(errorPanel).toBeVisible({ timeout: 10000 });

    const errText = (await errorPanel.textContent()) || '';
    // Ajv-style messages reference the JSON path for the missing field.
    expect(errText.toLowerCase()).toMatch(/name/);
    expect(errText.toLowerCase()).toMatch(/info/);

    // Modal stays on the error step (no commit happened) — this is the strong
    // signal that nothing was written. Don't assert sidebar state because other
    // parallel/preceding tests in the describe block may have created collections
    // that share the common `timestamp` namespace.
  });

  // ---------- 4. insomnia-basic-import ----------
  test('insomnia-basic-import — folders + requests + base env variables land correctly', async ({ page }) => {
    const fixture = loadFixture('insomnia-v4-basic.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = renameInsomniaWorkspace(cloned, `${timestamp}`);

    await openImportModal(page);
    await pickFormat(page, 'insomnia-v4');
    await uploadFixture(page, cloned, 'insomnia-v4-basic.json');

    // Preview summary should appear with the expected counts.
    const preview = page.locator('[data-testid="import-preview-summary"]');
    await expect(preview).toBeVisible({ timeout: 15000 });
    const previewText = ((await preview.textContent()) || '').toLowerCase();
    expect(previewText).toMatch(/1\s*folder/);
    expect(previewText).toMatch(/3\s*request/);
    expect(previewText).toMatch(/2\s*variab/);

    await page.locator('[data-testid="import-commit"]').click();

    // Dismiss any warnings modal.
    const warningsList = page.locator('[data-testid="confirm-list"]');
    if (await warningsList.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('.confirm-btn-confirm').click();
      await expect(warningsList).not.toBeVisible({ timeout: 5000 });
    }

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });

    // Variables tab: api_key + base_url.
    await rootHeader.locator('.collection-name').click();
    await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });
    await page.locator('.collection-editor-tab').filter({ hasText: 'Variables' }).click();
    await expect(page.locator('.collection-variables-tab')).toBeVisible({ timeout: 5000 });

    const varsTable = page.locator('.collection-variables-tab .env-var-table tbody tr');
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

    // Expand root + Folder A, verify three requests.
    await expandCollectionHeader(page, rootHeader);
    const folderA = page.locator('.collection-header').filter({ hasText: 'Folder A' });
    await expect(folderA).toBeVisible({ timeout: 5000 });
    await expandCollectionHeader(page, folderA);

    await expect(page.locator('.request-item').filter({ hasText: 'List Items' })).toBeVisible();
    await expect(page.locator('.request-item').filter({ hasText: 'Create Item' })).toBeVisible();
    await expect(page.locator('.request-item').filter({ hasText: 'Delete Item' })).toBeVisible();
  });

  // ---------- 5. insomnia-response-tag-rewrite ----------
  test('insomnia-response-tag-rewrite — producing request gains post-script, consumer gets {{<slug>_token}}', async ({ page }) => {
    const fixture = loadFixture('insomnia-v4-with-response-tag.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = renameInsomniaWorkspace(cloned, `${timestamp}-rewrite`);

    await openImportModal(page);
    await pickFormat(page, 'insomnia-v4');
    await uploadFixture(page, cloned, 'insomnia-v4-with-response-tag.json');

    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="import-commit"]').click();

    // Warnings modal should list the rewrite.
    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 15000 });
    const warningsText = ((await warningsList.textContent()) || '').toLowerCase();
    expect(warningsText).toMatch(/response/);
    await page.locator('.confirm-btn-confirm').click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });
    await expandCollectionHeader(page, rootHeader);

    const chainFolder = page.locator('.collection-header').filter({ hasText: 'Chain' });
    await expect(chainFolder).toBeVisible({ timeout: 5000 });
    await expandCollectionHeader(page, chainFolder);

    // Request A (Login): Post-script should contain pm.response.json + pm.collectionVariables.set.
    const loginItem = page.locator('.request-item').filter({ hasText: 'Login' });
    await expect(loginItem).toBeVisible({ timeout: 5000 });
    await loginItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
    await page.locator('.request-tabs button').filter({ hasText: 'Post-script' }).click();
    await expect(page.locator('.script-editor-wrapper')).toBeVisible({ timeout: 5000 });
    const scriptContent = page.locator('.script-codemirror .cm-content');
    await expect(scriptContent).toContainText('pm.response.json()');
    await expect(scriptContent).toContainText('pm.collectionVariables.set(');

    // Request B (Protected): Auth tab, token should match /^\{\{\w+_token\}\}$/.
    const protectedItem = page.locator('.request-item').filter({ hasText: 'Protected' });
    await expect(protectedItem).toBeVisible({ timeout: 5000 });
    await protectedItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
    await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();
    const tokenField = page.locator('.auth-token-field');
    await expect(tokenField).toBeVisible({ timeout: 5000 });
    const tokenValue = (await tokenField.inputValue()) || '';
    expect(tokenValue).toMatch(/^\{\{\w+_token\}\}$/);
  });

  // ---------- 6. insomnia-response-tag-unresolvable ----------
  test('insomnia-response-tag-unresolvable — missing producer yields {{TODO_FIX_insomnia_response}}', async ({ page }) => {
    const fixture = loadFixture('insomnia-v4-unresolvable-response-tag.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = renameInsomniaWorkspace(cloned, `${timestamp}-ghost`);

    await openImportModal(page);
    await pickFormat(page, 'insomnia-v4');
    await uploadFixture(page, cloned, 'insomnia-v4-unresolvable-response-tag.json');

    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="import-commit"]').click();

    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 15000 });
    const warningsText = (await warningsList.textContent()) || '';
    expect(warningsText).toContain('TODO_FIX');
    await page.locator('.confirm-btn-confirm').click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });
    await expandCollectionHeader(page, rootHeader);

    // Filter by the folder name's `.collection-name` span to avoid also matching
    // the root collection whose name contains "Ghost Ref".
    const ghostFolder = page.locator('.collection-header').filter({
      has: page.locator('.collection-name', { hasText: /^Ghost$/ }),
    });
    await expect(ghostFolder).toBeVisible({ timeout: 5000 });
    await expandCollectionHeader(page, ghostFolder);

    const protectedItem = page.locator('.request-item').filter({ hasText: 'Protected' });
    await expect(protectedItem).toBeVisible({ timeout: 5000 });
    await protectedItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });
    await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();
    await expect(page.locator('.auth-token-field')).toHaveValue('{{TODO_FIX_insomnia_response}}');
  });

  // ---------- 7. postman-dynamics-warning ----------
  test('postman-dynamics-warning — guid/timestamp auto-seeded; unknown $nope warned', async ({ page }) => {
    const fixture = loadFixture('postman-v2.1-with-dynamics.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = `${cloned.info.name} ${timestamp}-dyn`;
    cloned.info.name = rootName;

    await openImportModal(page);
    await pickFormat(page, 'postman-v2.1');
    await uploadFixture(page, cloned, 'postman-v2.1-with-dynamics.json');

    const preview = page.locator('[data-testid="import-preview-summary"]');
    await expect(preview).toBeVisible({ timeout: 15000 });
    const warningsSummary = page.locator('[data-testid="import-preview-warnings"]');
    await expect(warningsSummary).toBeVisible();
    const warningsSummaryText = ((await warningsSummary.textContent()) || '').toLowerCase();
    // Should mention multiple warnings — at least 2.
    const numMatch = warningsSummaryText.match(/(\d+)/);
    if (numMatch) {
      expect(parseInt(numMatch[1], 10)).toBeGreaterThanOrEqual(2);
    }

    await page.locator('[data-testid="import-commit"]').click();

    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 15000 });
    const warningsText = ((await warningsList.textContent()) || '').toLowerCase();
    expect(warningsText).toMatch(/guid/);
    expect(warningsText).toMatch(/timestamp/);
    expect(warningsText).toContain('$nope');
    await page.locator('.confirm-btn-confirm').click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });

    // Collection Variables tab should contain `guid` (auto-seeded).
    await rootHeader.locator('.collection-name').click();
    await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });
    await page.locator('.collection-editor-tab').filter({ hasText: 'Variables' }).click();
    await expect(page.locator('.collection-variables-tab')).toBeVisible({ timeout: 5000 });

    const varsTable = page.locator('.collection-variables-tab .env-var-table tbody tr');
    const rowCount = await varsTable.count();
    const keys: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const k = await varsTable.nth(i).locator('td.col-key input').inputValue().catch(() => '');
      if (k) keys.push(k);
    }
    expect(keys).toContain('guid');
  });

  // ---------- 8. self-format-roundtrip ----------
  test('self-format-roundtrip — export then re-import via Post Umbrella format preserves state', async ({ page }) => {
    // Use the same insomnia-v4-basic fixture path: import as Insomnia first, then export
    // and re-import via Post Umbrella. Re-uses setup from test #4.
    const fixture = loadFixture('insomnia-v4-basic.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = renameInsomniaWorkspace(cloned, `${timestamp}-self`);

    await openImportModal(page);
    await pickFormat(page, 'insomnia-v4');
    await uploadFixture(page, cloned, 'insomnia-v4-basic.json');

    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="import-commit"]').click();

    const warningsList = page.locator('[data-testid="confirm-list"]');
    if (await warningsList.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('.confirm-btn-confirm').click();
      await expect(warningsList).not.toBeVisible({ timeout: 5000 });
    }

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });

    // Export via the collection menu.
    await rootHeader.hover();
    const moreBtn = rootHeader.locator('.btn-menu');
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    const menu = page.locator('.collection-menu');
    await expect(menu).toBeVisible();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await menu.locator('.request-menu-item').filter({ hasText: 'Export' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) chunks.push(Buffer.from(chunk));
    const exportedJson: any = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

    // Rename the exported collection so the re-import doesn't collide with the original.
    const reimportName = `${rootName}-reimport`;
    exportedJson.info.name = reimportName;

    // Re-import via Post Umbrella format.
    await openImportModal(page);
    await pickFormat(page, 'post-umbrella');
    await uploadFixture(page, exportedJson, 'post-umbrella-export.json');

    const preview2 = page.locator('[data-testid="import-preview-summary"]');
    await expect(preview2).toBeVisible({ timeout: 15000 });
    const preview2Text = ((await preview2.textContent()) || '').toLowerCase();
    expect(preview2Text).toMatch(/1\s*folder/);
    expect(preview2Text).toMatch(/3\s*request/);
    expect(preview2Text).toMatch(/2\s*variab/);

    await page.locator('[data-testid="import-commit"]').click();

    if (await warningsList.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('.confirm-btn-confirm').click();
      await expect(warningsList).not.toBeVisible({ timeout: 5000 });
    }

    const reimportedHeader = page.locator('.collection-header').filter({ hasText: reimportName });
    await expect(reimportedHeader).toBeVisible({ timeout: 30000 });
  });

  // ---------- 9. preview-cancel ----------
  test('preview-cancel — cancelling the preview step does not create a collection', async ({ page }) => {
    const fixture = loadFixture('insomnia-v4-basic.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = renameInsomniaWorkspace(cloned, `${timestamp}-cancel`);

    await openImportModal(page);
    await pickFormat(page, 'insomnia-v4');
    await uploadFixture(page, cloned, 'insomnia-v4-basic.json');

    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });

    // Dismiss via the modal's close (×) button — preview step has Back+Import, cancel lives in the header.
    const modal = page.locator('[data-testid="import-modal"]');
    await modal.locator('.modal-close').click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Collection should NOT appear.
    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await page.waitForTimeout(1500);
    expect(await rootHeader.count()).toBe(0);
  });

  // ---------- 10. warnings-merge ----------
  test('warnings-merge — client + server warnings appear in a single deduplicated modal', async ({ page }) => {
    // postman-v2.1-with-dynamics.json emits client-side warnings (dynamics) AND
    // its APIKey request makes the server emit its own warning — union should
    // show both without duplicates.
    const fixture = loadFixture('postman-v2.1-with-dynamics.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = `${cloned.info.name} ${timestamp}-merge`;
    cloned.info.name = rootName;

    await openImportModal(page);
    await pickFormat(page, 'postman-v2.1');
    await uploadFixture(page, cloned, 'postman-v2.1-with-dynamics.json');

    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="import-commit"]').click();

    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 30000 });

    // Collect all <li> entries and assert union + no duplicates.
    const entries = await warningsList.locator('li').allTextContents();
    const normalized = entries.map((s) => s.trim()).filter(Boolean);
    const unique = new Set(normalized);
    expect(unique.size).toBe(normalized.length);

    const joined = normalized.join('\n').toLowerCase();
    // Client-side: dynamics (guid / timestamp / $nope).
    expect(joined).toMatch(/guid|timestamp|\$nope/);
    // Server-side: api key advisory from the APIKey request.
    expect(joined).toMatch(/api\s*key/);

    await page.locator('.confirm-btn-confirm').click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });
  });
});
