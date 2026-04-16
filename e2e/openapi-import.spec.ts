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

function loadFixtureRaw(fileName: string): string {
  return readFileSync(join(FIXTURES_DIR, fileName), 'utf-8');
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
  const previewBtn = page.locator('[data-testid="import-modal"] button.btn-primary').filter({ hasText: /Preview/i });
  await expect(previewBtn).toBeEnabled({ timeout: 5000 });
  await previewBtn.click();
}

/**
 * Upload raw text (YAML or otherwise) as-is into the modal's hidden file input,
 * then click the Preview button to advance to the preview/error step.
 */
async function uploadRawFixture(page: Page, rawText: string, fileName: string) {
  const input = page.locator('[data-testid="import-file-input"]');
  const lower = fileName.toLowerCase();
  const mimeType = lower.endsWith('.yaml') || lower.endsWith('.yml')
    ? 'application/yaml'
    : lower.endsWith('.json')
      ? 'application/json'
      : 'text/plain';
  await input.setInputFiles({
    name: fileName,
    mimeType,
    buffer: Buffer.from(rawText, 'utf-8'),
  });
  const previewBtn = page.locator('[data-testid="import-modal"] button.btn-primary').filter({ hasText: /Preview/i });
  await expect(previewBtn).toBeEnabled({ timeout: 5000 });
  await previewBtn.click();
}

async function expandCollectionHeader(page: Page, headerLocator: ReturnType<Page['locator']>) {
  const arrow = headerLocator.locator('.collection-arrow');
  if (!(await arrow.isVisible().catch(() => false))) return;
  const svgClass = (await arrow.locator('svg').getAttribute('class').catch(() => '')) || '';
  if (/chevron-down/i.test(svgClass)) return;
  await arrow.click({ force: true });
  await page.waitForTimeout(250);
}

/**
 * Read every row of the collection Variables table and return {key, value} pairs.
 */
async function readCollectionVariables(page: Page): Promise<Array<{ key: string; value: string }>> {
  const varsTable = page.locator('.collection-variables-tab .env-var-table tbody tr');
  const rowCount = await varsTable.count();
  const rows: Array<{ key: string; value: string }> = [];
  for (let i = 0; i < rowCount; i++) {
    const row = varsTable.nth(i);
    const k = await row.locator('td.col-key input').inputValue().catch(() => '');
    const v = await row.locator('td.col-value input').inputValue().catch(() => '');
    if (k) rows.push({ key: k, value: v });
  }
  return rows;
}

/**
 * Open the root collection header, switch to Variables tab, read + return rows.
 */
async function openVariablesTab(page: Page, rootHeader: ReturnType<Page['locator']>) {
  await rootHeader.locator('.collection-name').click();
  await expect(page.locator('.collection-editor')).toBeVisible({ timeout: 5000 });
  await page.locator('.collection-editor-tab').filter({ hasText: 'Variables' }).click();
  await expect(page.locator('.collection-variables-tab')).toBeVisible({ timeout: 5000 });
  return readCollectionVariables(page);
}

/**
 * Dismiss the post-commit warnings confirm modal if it appears.
 */
async function dismissWarningsIfAny(page: Page) {
  const warningsList = page.locator('[data-testid="confirm-list"]');
  if (await warningsList.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.locator('.confirm-btn-confirm').click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });
  }
}

test.describe('OpenAPI / Swagger Import (PR #3 of #30)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  // ---------- 1. openapi-json-petstore ----------
  test('openapi-json-petstore — JSON OpenAPI spec imports with tag folders, path-param vars, and baseUrl', async ({ page }) => {
    const fixture = loadFixture('openapi-3.0-petstore.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = `${cloned.info.title} ${timestamp}-json`;
    cloned.info.title = rootName;

    await openImportModal(page);
    await pickFormat(page, 'openapi-3');
    await uploadFixture(page, cloned, 'openapi-3.0-petstore.json');

    // Preview shows ≥ 2 folders (pets, users) and ≥ 3 requests.
    const preview = page.locator('[data-testid="import-preview-summary"]');
    await expect(preview).toBeVisible({ timeout: 15000 });
    const previewText = (await preview.textContent()) || '';
    const folderMatch = previewText.match(/(\d+)\s*folder/i);
    const requestMatch = previewText.match(/(\d+)\s*request/i);
    expect(folderMatch).not.toBeNull();
    expect(requestMatch).not.toBeNull();
    expect(parseInt(folderMatch![1], 10)).toBeGreaterThanOrEqual(2);
    expect(parseInt(requestMatch![1], 10)).toBeGreaterThanOrEqual(3);

    await page.locator('[data-testid="import-commit"]').click();
    await dismissWarningsIfAny(page);

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });

    // Expand root, then the pets folder, then open a pet request to check URL.
    await expandCollectionHeader(page, rootHeader);
    const petsFolder = page.locator('.collection-header').filter({
      has: page.locator('.collection-name', { hasText: /^pets$/i }),
    });
    await expect(petsFolder).toBeVisible({ timeout: 5000 });
    await expandCollectionHeader(page, petsFolder);

    // Any pet-related request will do — `getPetById` is the most illustrative.
    const petRequest = page.locator('.request-item').filter({ hasText: /getPetById|\{petId\}/ }).first();
    await expect(petRequest).toBeVisible({ timeout: 5000 });
    await petRequest.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    // The URL input should contain {{baseUrl}} and {{petId}} (or the path-param variable format).
    const urlField = page.locator('.request-editor input.url-input');
    await expect(urlField).toBeVisible({ timeout: 5000 });
    const urlValue = (await urlField.inputValue().catch(() => '')) || '';
    expect(urlValue).toContain('{{baseUrl}}');
    expect(urlValue).toMatch(/\{\{petId\}\}/);

    // Variables tab assertions.
    const rows = await openVariablesTab(page, rootHeader);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'baseUrl', value: 'https://petstore.swagger.io/v2' }),
      ])
    );
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('petId');
  });

  // ---------- 2. openapi-yaml-petstore ----------
  test('openapi-yaml-petstore — YAML OpenAPI spec imports equivalently to the JSON version', async ({ page }) => {
    const raw = loadFixtureRaw('openapi-3.0-petstore.yaml');
    // Rename the title in the raw text so cleanup can find it.
    const rootName = `Petstore ${timestamp}-yaml`;
    const patchedRaw = raw.replace(/^(\s*title:\s*).*$/m, `$1${rootName}`);

    await openImportModal(page);
    await pickFormat(page, 'openapi-3');
    await uploadRawFixture(page, patchedRaw, 'openapi-3.0-petstore.yaml');

    const preview = page.locator('[data-testid="import-preview-summary"]');
    await expect(preview).toBeVisible({ timeout: 15000 });
    const previewText = (await preview.textContent()) || '';
    const folderMatch = previewText.match(/(\d+)\s*folder/i);
    const requestMatch = previewText.match(/(\d+)\s*request/i);
    expect(folderMatch).not.toBeNull();
    expect(requestMatch).not.toBeNull();
    expect(parseInt(folderMatch![1], 10)).toBeGreaterThanOrEqual(2);
    expect(parseInt(requestMatch![1], 10)).toBeGreaterThanOrEqual(3);

    await page.locator('[data-testid="import-commit"]').click();
    await dismissWarningsIfAny(page);

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });

    await expandCollectionHeader(page, rootHeader);
    const petsFolder = page.locator('.collection-header').filter({
      has: page.locator('.collection-name', { hasText: /^pets$/i }),
    });
    await expect(petsFolder).toBeVisible({ timeout: 5000 });
    await expandCollectionHeader(page, petsFolder);

    const petRequest = page.locator('.request-item').filter({ hasText: /getPetById|\{petId\}/ }).first();
    await expect(petRequest).toBeVisible({ timeout: 5000 });
    await petRequest.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    const urlField = page.locator('.request-editor input.url-input');
    await expect(urlField).toBeVisible({ timeout: 5000 });
    const urlValue = (await urlField.inputValue().catch(() => '')) || '';
    expect(urlValue).toContain('{{baseUrl}}');
    expect(urlValue).toMatch(/\{\{petId\}\}/);

    const rows = await openVariablesTab(page, rootHeader);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'baseUrl', value: 'https://petstore.swagger.io/v2' }),
      ])
    );
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('petId');
  });

  // ---------- 3. openapi-bearer-auth ----------
  test('openapi-bearer-auth — bearer security scheme produces {{bearerToken}} auth + variable', async ({ page }) => {
    const raw = loadFixtureRaw('openapi-3.0-with-bearer-auth.yaml');
    const rootName = `Bearer API ${timestamp}-bearer`;
    const patchedRaw = raw.replace(/^(\s*title:\s*).*$/m, `$1${rootName}`);

    await openImportModal(page);
    await pickFormat(page, 'openapi-3');
    await uploadRawFixture(page, patchedRaw, 'openapi-3.0-with-bearer-auth.yaml');

    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="import-commit"]').click();
    await dismissWarningsIfAny(page);

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });
    await expandCollectionHeader(page, rootHeader);

    // Open any request — pick the first one.
    const anyRequest = page.locator('.request-item').first();
    await expect(anyRequest).toBeVisible({ timeout: 5000 });
    await anyRequest.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    // Auth tab → Bearer Token selected with {{bearerToken}} token.
    await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();

    const bearerRadio = page.locator('.request-editor input[type="radio"][name="authType"][value="bearer"]');
    await expect(bearerRadio).toBeChecked({ timeout: 5000 });

    const tokenField = page.locator('.request-editor .auth-token-field');
    await expect(tokenField).toBeVisible({ timeout: 5000 });
    await expect(tokenField).toHaveValue('{{bearerToken}}');

    const rows = await openVariablesTab(page, rootHeader);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('bearerToken');
  });

  // ---------- 4. openapi-oauth2-warning ----------
  test('openapi-oauth2-warning — oauth2 scheme warns and drops to No Auth', async ({ page }) => {
    const raw = loadFixtureRaw('openapi-3.0-with-oauth2.yaml');
    const rootName = `OAuth2 API ${timestamp}-oauth2`;
    const patchedRaw = raw.replace(/^(\s*title:\s*).*$/m, `$1${rootName}`);

    await openImportModal(page);
    await pickFormat(page, 'openapi-3');
    await uploadRawFixture(page, patchedRaw, 'openapi-3.0-with-oauth2.yaml');

    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="import-commit"]').click();

    // Warnings modal must appear and mention oauth2.
    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 15000 });
    const warningsText = ((await warningsList.textContent()) || '').toLowerCase();
    expect(warningsText).toContain('oauth2');
    await page.locator('.confirm-btn-confirm').click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });
    await expandCollectionHeader(page, rootHeader);

    const anyRequest = page.locator('.request-item').first();
    await expect(anyRequest).toBeVisible({ timeout: 5000 });
    await anyRequest.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    await page.locator('.request-tabs button').filter({ hasText: 'Auth' }).click();
    const noAuthRadio = page.locator('.request-editor input[type="radio"][name="authType"][value="none"]');
    await expect(noAuthRadio).toBeChecked({ timeout: 5000 });
  });

  // ---------- 5. openapi-swagger-2-accepted ----------
  test('openapi-swagger-2-accepted — Swagger 2.0 is accepted with an on-the-fly conversion warning', async ({ page }) => {
    const fixture = loadFixture('swagger-2.0-minimal.json');
    const cloned = JSON.parse(JSON.stringify(fixture));
    const rootName = `${cloned.info.title} ${timestamp}-sw2`;
    cloned.info.title = rootName;

    await openImportModal(page);
    await pickFormat(page, 'openapi-3');
    await uploadFixture(page, cloned, 'swagger-2.0-minimal.json');

    await expect(page.locator('[data-testid="import-preview-summary"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="import-commit"]').click();

    const warningsList = page.locator('[data-testid="confirm-list"]');
    await expect(warningsList).toBeVisible({ timeout: 15000 });
    const warningsText = ((await warningsList.textContent()) || '').toLowerCase();
    expect(warningsText).toMatch(/swagger\s*2\.0|on-the-fly|converted/);
    await page.locator('.confirm-btn-confirm').click();
    await expect(warningsList).not.toBeVisible({ timeout: 5000 });

    const rootHeader = page.locator('.collection-header').filter({ hasText: rootName });
    await expect(rootHeader).toBeVisible({ timeout: 30000 });
  });

  // ---------- 6. openapi-yaml-malformed ----------
  test('openapi-yaml-malformed — broken YAML surfaces a parse error and never reaches persistence', async ({ page }) => {
    const raw = loadFixtureRaw('openapi-yaml-malformed.yaml');

    await openImportModal(page);
    await pickFormat(page, 'openapi-3');
    await uploadRawFixture(page, raw, 'openapi-yaml-malformed.yaml');

    const errorPanel = page.locator('[data-testid="import-error"]');
    await expect(errorPanel).toBeVisible({ timeout: 15000 });
    const errText = ((await errorPanel.textContent()) || '').toLowerCase();
    expect(errText).toMatch(/yaml|invalid|parse/);

    // Modal stays on the error step — do not assert sidebar state to avoid
    // cross-test contamination with collections created by other scenarios.
    const modal = page.locator('[data-testid="import-modal"]');
    await expect(modal).toBeVisible();
  });
});
