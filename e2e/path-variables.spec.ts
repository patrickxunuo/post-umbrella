import { test, expect, Page } from '@playwright/test';
import { cleanupTestCollections, cleanupTestEnvironments } from './helpers/cleanup';

const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

test.afterAll(async () => {
  await cleanupTestCollections(timestamp);
  await cleanupTestEnvironments(timestamp);
});

async function waitForAppReady(page: Page) {
  await page.goto('/');
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
  await page.evaluate(() => {
    const toast = document.querySelector('.version-toast');
    if (toast) (toast as HTMLElement).style.display = 'none';
  });
}

async function createCollection(page: Page, name: string) {
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

async function addRequestInCollection(page: Page, collectionName: string) {
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

async function createTestRequest(page: Page, collectionName: string) {
  await createCollection(page, collectionName);
  await addRequestInCollection(page, collectionName);
}

async function openParamsTab(page: Page) {
  await page.locator('.request-tabs button').filter({ hasText: 'Params' }).click();
}

async function openHeadersTab(page: Page) {
  await page.locator('.request-tabs button').filter({ hasText: 'Headers' }).click();
}

async function openConsolePanel(page: Page) {
  const consoleBtn = page.locator('[data-testid="bottom-bar"]').locator('text=Console');
  await expect(consoleBtn).toBeVisible({ timeout: 5000 });
  const isAlreadyOpen = await page.locator('[data-testid="console-panel"]').isVisible().catch(() => false);
  if (!isAlreadyOpen) {
    await consoleBtn.click();
    await expect(page.locator('[data-testid="console-panel"]')).toBeVisible({ timeout: 5000 });
  }
}

async function clearConsole(page: Page) {
  await openConsolePanel(page);
  const clearBtn = page.locator('[data-testid="console-clear"]');
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
  }
}

async function sendRequestAndWait(page: Page) {
  const sendButton = page.locator('.btn-send');
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  // Don't require .response-viewer to be visible — when the Console panel is open,
  // it can shrink the viewer to ~0 height in the default Playwright viewport. Use the
  // Send→Cancel→Send button transition as the completion signal instead.
  await expect(page.locator('.btn-cancel-request')).toHaveCount(0, { timeout: 30000 });
  await expect(sendButton).toBeEnabled({ timeout: 5000 });
}

async function getResolvedUrlFromConsole(page: Page): Promise<string | null> {
  await openConsolePanel(page);
  // Find any console-message containing "Resolved URL:"
  const messages = page.locator('.console-panel-body .console-message');
  const count = await messages.count();
  for (let i = 0; i < count; i++) {
    const text = (await messages.nth(i).textContent()) || '';
    const match = text.match(/Resolved URL:\s*(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

async function openCurlPanel(page: Page) {
  const curlBtn = page.locator('.btn-copy-curl');
  await expect(curlBtn).toBeVisible({ timeout: 5000 });
  const className = (await curlBtn.getAttribute('class')) || '';
  if (!className.includes('active')) {
    await curlBtn.click();
  }
  await expect(page.locator('.curl-panel')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="curl-panel-code"]')).toBeVisible({ timeout: 5000 });
}

async function readCurlText(page: Page): Promise<string> {
  const code = page.locator('[data-testid="curl-panel-code"] .cm-content');
  await expect(code).toBeVisible({ timeout: 5000 });
  return (await code.innerText()).replace(/ /g, ' ');
}

async function openEnvironmentEditor(page: Page) {
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

async function createAndActivateEnvironment(page: Page, envName: string, key: string, value: string) {
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

  await envDrawer.locator('.env-drawer-header .btn-icon').click();
  const confirmDialog = page.locator('.confirm-modal');
  if (await confirmDialog.isVisible().catch(() => false)) {
    await confirmDialog.locator('.confirm-btn-cancel').click().catch(() => {});
  }
  await expect(envDrawer).not.toBeVisible({ timeout: 5000 });

  const envSelector = page.locator('.env-selector-trigger');
  await envSelector.click();
  const envDropdown = page.locator('.env-selector-dropdown');
  await expect(envDropdown).toBeVisible();
  await envDropdown.locator('.env-selector-option').filter({ hasText: envName }).click();
  await expect(envSelector).toContainText(envName);
  await expect(envSelector).toHaveClass(/has-env/);
}

async function saveRequest(page: Page) {
  const saveBtn = page.locator('.btn-save').first();
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('*', { timeout: 5000 });
}

test.describe('Path Variables', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  // AC-F1.3, AC-F1.4, AC-F2.11
  test('f1-pure-substitute-url', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F1 Pure'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/anything/:id');

    await openParamsTab(page);
    const section = page.locator('[data-testid="path-variables-section"]');
    await expect(section).toBeVisible({ timeout: 5000 });

    const valueInput = page.locator('[data-testid="path-variable-value-input-id"]');
    await expect(valueInput).toBeVisible();
    // EnvVariableInput wraps an actual <input>; target it with locator chain
    const valueField = valueInput.locator('input').first();
    await valueField.fill('42');

    await clearConsole(page);
    await sendRequestAndWait(page);

    const resolved = await getResolvedUrlFromConsole(page);
    expect(resolved).not.toBeNull();
    expect(resolved!).toContain('/anything/42');
    expect(resolved!).not.toContain(':id');
  });

  // AC-F1.3, AC-F2.12
  test('f1-path-var-with-env-interp', async ({ page }) => {
    const envName = uniqueName('PV Env');
    await createAndActivateEnvironment(page, envName, 'user_id', '99');

    await createTestRequest(page, uniqueName('PV F1 EnvInterp'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/anything/:id');

    await openParamsTab(page);
    await expect(page.locator('[data-testid="path-variables-section"]')).toBeVisible({ timeout: 5000 });

    const valueField = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await valueField.fill('{{user_id}}');

    await clearConsole(page);
    await sendRequestAndWait(page);

    const resolved = await getResolvedUrlFromConsole(page);
    expect(resolved).not.toBeNull();
    expect(resolved!).toContain('/anything/99');
    expect(resolved!).not.toContain('{{user_id}}');
    expect(resolved!).not.toContain(':id');
  });

  // AC-F2.1
  test('f2-typing-colon-adds-row', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 ColonAdds'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/anything/:id');

    await openParamsTab(page);
    await expect(page.locator('[data-testid="path-variables-section"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="path-variable-row-id"]')).toBeVisible();

    const keyField = page.locator('[data-testid="path-variable-key-id"]');
    await expect(keyField).toHaveValue('id');
  });

  // AC-F2.2
  test('f2-typing-just-colon-no-row', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 JustColon'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:');

    await openParamsTab(page);
    // Section should not be present (length 0)
    const section = page.locator('[data-testid="path-variables-section"]');
    await expect(section).toHaveCount(0);
  });

  // AC-F2.3
  test('f2-multiple-path-vars-ordered', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 Multi'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:userId/posts/:postId');

    await openParamsTab(page);
    const section = page.locator('[data-testid="path-variables-section"]');
    await expect(section).toBeVisible({ timeout: 5000 });

    const rows = section.locator('tbody tr');
    await expect(rows).toHaveCount(2);

    // First row should be userId, second postId
    const firstKey = rows.nth(0).locator('[data-testid^="path-variable-key-"]');
    const secondKey = rows.nth(1).locator('[data-testid^="path-variable-key-"]');
    await expect(firstKey).toHaveValue('userId');
    await expect(secondKey).toHaveValue('postId');

    await page.screenshot({ path: 'e2e/screenshots/path-vars-list-populated.png' });
  });

  // AC-F2.4
  test('f2-reserved-char-strips-colon', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 Strip'));

    const urlInput = page.locator('.url-input');
    await urlInput.click();
    await urlInput.fill('');
    // Type the prefix as a fill (fast), then individual keystrokes for the colon-then-slash
    await urlInput.fill('https://example.com/users/');
    await urlInput.focus();
    // Move caret to end
    await page.keyboard.press('End');
    await urlInput.pressSequentially(':/', { delay: 30 });

    // The colon should have been stripped — final URL is /users//
    await expect(urlInput).toHaveValue('https://example.com/users//');

    await openParamsTab(page);
    const section = page.locator('[data-testid="path-variables-section"]');
    await expect(section).toHaveCount(0);
  });

  // AC-F2.5
  test('f2-trailing-colon-preserved', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 Trailing'));

    const urlInput = page.locator('.url-input');
    await urlInput.click();
    await urlInput.fill('https://example.com/users/');
    await urlInput.focus();
    await page.keyboard.press('End');
    await urlInput.pressSequentially(':', { delay: 30 });

    // Trailing : preserved
    await expect(urlInput).toHaveValue('https://example.com/users/:');

    await openParamsTab(page);
    await expect(page.locator('[data-testid="path-variables-section"]')).toHaveCount(0);

    // Continue typing 'id'
    await urlInput.focus();
    await page.keyboard.press('End');
    await urlInput.pressSequentially('id', { delay: 30 });

    await expect(urlInput).toHaveValue('https://example.com/users/:id');
    await expect(page.locator('[data-testid="path-variables-section"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="path-variable-row-id"]')).toBeVisible();
  });

  // AC-F2.6
  test('f2-removing-name-removes-row', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 Remove'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:id');

    await openParamsTab(page);
    await expect(page.locator('[data-testid="path-variable-row-id"]')).toBeVisible({ timeout: 5000 });

    await urlInput.focus();
    await page.keyboard.press('End');
    // Backspace 3 times to remove ':id'
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    await expect(urlInput).toHaveValue('https://example.com/users/');
    await expect(page.locator('[data-testid="path-variables-section"]')).toHaveCount(0);
  });

  // AC-F2.8
  test('f2-key-readonly', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 ReadOnly'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:id');

    await openParamsTab(page);
    const keyField = page.locator('[data-testid="path-variable-key-id"]');
    await expect(keyField).toBeVisible({ timeout: 5000 });
    await expect(keyField).toHaveAttribute('readonly', '');
    await expect(keyField).toHaveValue('id');

    // Try to type — value must not change
    await keyField.click({ force: true });
    await page.keyboard.type('xyz', { delay: 20 });
    await expect(keyField).toHaveValue('id');
  });

  // AC-F2.9, AC-F2.10
  test('f2-value-edit-in-list', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 ValueEdit'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/anything/:id');

    await openParamsTab(page);
    const valueField = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await expect(valueField).toBeVisible({ timeout: 5000 });
    await valueField.fill('42');
    await expect(valueField).toHaveValue('42');

    await saveRequest(page);

    // Re-check value persists in the editor (without reload, as a sanity check on save not stripping)
    await expect(valueField).toHaveValue('42');
  });

  // AC-F1.2, AC-F2.10, AC-F2.11
  test('f2-persistence-across-reload', async ({ page }) => {
    const colName = uniqueName('PV F2 Persist');
    await createTestRequest(page, colName);

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/anything/:id');

    await openParamsTab(page);
    const valueField = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await valueField.fill('7');

    await saveRequest(page);

    // Reload page
    await page.reload();
    await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.sidebar')).toBeVisible();

    // Re-open the request
    const collectionHeader = page.locator('.collection-header').filter({ hasText: colName });
    await expect(collectionHeader).toBeVisible({ timeout: 10000 });
    // Expand collection if collapsed
    await collectionHeader.click().catch(() => {});
    const requestItem = page.locator('.request-item').first();
    await expect(requestItem).toBeVisible({ timeout: 10000 });
    await requestItem.click();

    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.url-input')).toHaveValue('https://httpbin.org/anything/:id');

    await openParamsTab(page);
    const reloadedValue = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await expect(reloadedValue).toHaveValue('7');

    // Send and verify substitution still works
    await clearConsole(page);
    await sendRequestAndWait(page);
    const resolved = await getResolvedUrlFromConsole(page);
    expect(resolved).not.toBeNull();
    expect(resolved!).toContain('/anything/7');
  });

  // AC-F2.13
  test('f2-curl-preview-matches', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 Curl'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/anything/:id');

    await openParamsTab(page);
    const valueField = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await valueField.fill('7');

    await openCurlPanel(page);
    const curl = await readCurlText(page);
    expect(curl).toContain('/anything/7');
    expect(curl).not.toContain(':id');

    await page.screenshot({ path: 'e2e/screenshots/path-vars-curl-preview.png' });

    // Edit value live and confirm curl updates
    await valueField.fill('100');
    // Allow re-render
    await page.waitForTimeout(200);
    const curl2 = await readCurlText(page);
    expect(curl2).toContain('/anything/100');
    expect(curl2).not.toContain('/anything/7');
  });

  // AC-F2.14
  test('f2-duplicate-name-single-row', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 Dup'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://httpbin.org/anything/:id/sub/:id');

    await openParamsTab(page);
    const section = page.locator('[data-testid="path-variables-section"]');
    await expect(section).toBeVisible({ timeout: 5000 });
    const rows = section.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-testid="path-variable-row-id"]')).toBeVisible();

    const valueField = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await valueField.fill('X');

    await clearConsole(page);
    await sendRequestAndWait(page);
    const resolved = await getResolvedUrlFromConsole(page);
    expect(resolved).not.toBeNull();
    expect(resolved!).toContain('/anything/X/sub/X');
  });

  // AC-F2.15
  test('f2-section-hidden-when-no-path-vars', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 Hidden'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/api/users');

    await openParamsTab(page);
    await expect(page.locator('[data-testid="path-variables-section"]')).toHaveCount(0);
  });

  // AC-F1.9 — port number after host must NOT be parsed as a path variable
  test('f1-port-not-treated-as-pathvar', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F1 Port'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://localhost:3000/api/:id');

    await openParamsTab(page);
    await expect(page.locator('[data-testid="path-variables-section"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="path-variable-row-id"]')).toBeVisible();
    // The 3000 (port) MUST NOT have been parsed as a path-var row.
    await expect(page.locator('[data-testid="path-variable-row-3000"]')).toHaveCount(0);
    const rows = page.locator('[data-testid="path-variables-section"] tbody tr');
    await expect(rows).toHaveCount(1);
  });

  // AC-F1.10 — `:` characters inside the query string must NOT be parsed as path variables
  test('f1-query-colon-not-pathvar', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F1 Query'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/api/:id?ts=2024:01:01');

    await openParamsTab(page);
    await expect(page.locator('[data-testid="path-variables-section"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="path-variable-row-id"]')).toBeVisible();
    // The :01 occurrences in the query string MUST NOT spawn rows.
    await expect(page.locator('[data-testid="path-variable-row-01"]')).toHaveCount(0);
    const rows = page.locator('[data-testid="path-variables-section"] tbody tr');
    await expect(rows).toHaveCount(1);
  });

  // AC-F2.16 — query params and path vars coexist independently
  test('f2-params-and-pathvars-coexist', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F2 Coexist'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:id?active=true');

    await openParamsTab(page);
    // Path Variables row for :id
    await expect(page.locator('[data-testid="path-variables-section"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="path-variable-row-id"]')).toBeVisible();
    // Query params table contains the active=true row
    const paramsBody = page.locator('.params-editor table tbody');
    await expect(paramsBody.locator('input[value="active"]')).toBeVisible();
    await expect(paramsBody.locator('input[value="true"]')).toBeVisible();
  });

  // AC-F3.1, AC-F3.2
  test('f3-overlay-highlight-on-url', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F3 Overlay'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:id');

    // The overlay element renders alongside the input when variables are present
    const overlay = page.locator('.env-variable-input-wrapper:has(.url-input) .env-var-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Highlight span for :id (resolved or unresolved depending on whether value is filled)
    const highlight = overlay.locator('.env-var-highlight.path-resolved, .env-var-highlight.path-unresolved').filter({ hasText: ':id' });
    await expect(highlight).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/path-vars-overlay-highlight.png' });
  });

  // AC-F3.1
  test('f3-overlay-no-highlight-in-headers', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F3 NoHdr'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:id');

    await openHeadersTab(page);
    const headersEditor = page.locator('.headers-editor');
    await expect(headersEditor).toBeVisible();

    const headerKey = headersEditor.locator('tbody tr').first().locator('input[placeholder="Header name"]');
    const headerVal = headersEditor.locator('tbody tr').first().locator('input[placeholder="Value"]');
    await headerKey.fill('X-Test');
    await headerVal.fill(':id');

    // The header value's wrapper should NOT contain a path-resolved/unresolved highlight
    const headerWrapper = headersEditor.locator('tbody tr').first().locator('.env-variable-input-wrapper').last();
    const pathHighlight = headerWrapper.locator('.env-var-highlight.path-resolved, .env-var-highlight.path-unresolved');
    await expect(pathHighlight).toHaveCount(0);
  });

  // AC-F3.3
  test('f3-popover-opens-on-hover', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F3 Popover'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:id');

    await openParamsTab(page);
    const valueField = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await valueField.fill('42');

    // Hover over :id in the URL — compute pixel offset based on the input's font size
    // The hover handler in EnvVariableInput uses charWidth = fontSize * 0.6 + paddingLeft.
    // We'll dispatch a mousemove event at a position inside the :id token.
    const url = 'https://example.com/users/:id';
    const colonIdx = url.indexOf(':id');
    const handle = await page.locator('.url-input').elementHandle();
    if (!handle) throw new Error('url-input not found');

    await page.evaluate(({ el, charIdx }) => {
      const input = el as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      const paddingLeft = parseFloat(style.paddingLeft);
      const fontSize = parseFloat(style.fontSize);
      const charWidth = fontSize * 0.6;
      const x = rect.left + paddingLeft + charWidth * (charIdx + 1); // middle of token
      const y = rect.top + rect.height / 2;
      const evt = new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y });
      input.dispatchEvent(evt);
    }, { el: handle, charIdx: colonIdx });

    const popover = page.locator('.env-var-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(popover).toContainText('id');
    await expect(popover).toContainText('42');

    await page.screenshot({ path: 'e2e/screenshots/path-vars-popover.png' });
  });

  // AC-F3.4
  test('f3-popover-edits-value', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F3 PopEdit'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/users/:id');

    await openParamsTab(page);
    const valueField = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await valueField.fill('42');

    const url = 'https://example.com/users/:id';
    const colonIdx = url.indexOf(':id');
    const handle = await page.locator('.url-input').elementHandle();
    if (!handle) throw new Error('url-input not found');

    await page.evaluate(({ el, charIdx }) => {
      const input = el as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      const paddingLeft = parseFloat(style.paddingLeft);
      const fontSize = parseFloat(style.fontSize);
      const charWidth = fontSize * 0.6;
      const x = rect.left + paddingLeft + charWidth * (charIdx + 1);
      const y = rect.top + rect.height / 2;
      const evt = new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y });
      input.dispatchEvent(evt);
    }, { el: handle, charIdx: colonIdx });

    const popover = page.locator('.env-var-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Click to enter edit mode
    await popover.click();
    const editInput = popover.locator('input[type="text"], textarea').first();
    await expect(editInput).toBeVisible({ timeout: 5000 });
    await editInput.fill('99');
    await editInput.press('Enter');

    // Path Variables row value should now be 99
    const reloadedValue = page.locator('[data-testid="path-variable-value-input-id"]').locator('input').first();
    await expect(reloadedValue).toHaveValue('99', { timeout: 5000 });
  });

  // AC-F1.5, AC-F3.5
  test('f3-prefix-not-confused', async ({ page }) => {
    await createTestRequest(page, uniqueName('PV F3 Prefix'));

    const urlInput = page.locator('.url-input');
    await urlInput.fill('https://example.com/api/:foo/:foobar');

    await openParamsTab(page);
    const fooValue = page.locator('[data-testid="path-variable-value-input-foo"]').locator('input').first();
    const fooBarValue = page.locator('[data-testid="path-variable-value-input-foobar"]').locator('input').first();
    await fooValue.fill('A');
    await fooBarValue.fill('B');

    // Both rows present
    await expect(page.locator('[data-testid="path-variable-row-foo"]')).toBeVisible();
    await expect(page.locator('[data-testid="path-variable-row-foobar"]')).toBeVisible();

    // Hover :foo — popover shows foo (not foobar)
    const url = 'https://example.com/api/:foo/:foobar';
    const fooIdx = url.indexOf(':foo');
    const fooBarIdx = url.indexOf(':foobar');

    const handle = await page.locator('.url-input').elementHandle();
    if (!handle) throw new Error('url-input not found');

    const dispatchHover = async (charIdx: number) => {
      await page.evaluate(({ el, idx }) => {
        const input = el as HTMLInputElement;
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        const paddingLeft = parseFloat(style.paddingLeft);
        const fontSize = parseFloat(style.fontSize);
        const charWidth = fontSize * 0.6;
        const x = rect.left + paddingLeft + charWidth * (idx + 1);
        const y = rect.top + rect.height / 2;
        const evt = new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y });
        input.dispatchEvent(evt);
      }, { el: handle, idx: charIdx });
    };

    await dispatchHover(fooIdx);
    const popover = page.locator('.env-var-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(popover).toContainText('foo');
    // header text 'foo' must equal 'foo' (not 'foobar')
    const headerText1 = (await popover.locator('.env-var-name').textContent()) || '';
    expect(headerText1.trim().endsWith('foo')).toBeTruthy();

    // Move away to clear, then hover :foobar
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);

    await dispatchHover(fooBarIdx);
    await expect(popover).toBeVisible({ timeout: 5000 });
    const headerText2 = (await popover.locator('.env-var-name').textContent()) || '';
    expect(headerText2.trim().endsWith('foobar')).toBeTruthy();
  });
});
