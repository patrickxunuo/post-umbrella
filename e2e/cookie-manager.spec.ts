import { test, expect, Page, Locator } from '@playwright/test';
import { cleanupTestCollections } from './helpers/cleanup';

// Unique per-run names so parallel / repeated runs don't collide.
const timestamp = Date.now();
const uniqueName = (base: string) => `${base} ${timestamp}`;

// A unique domain per run. The cookie jar lives in localStorage ('pu_cookie_jar')
// and can carry between tests in the same browser context, so a timestamped
// domain keeps our assertions from colliding with leftover jar state.
const COOKIE_DOMAIN = `e2e-${timestamp}.example.com`;

test.afterAll(async () => { await cleanupTestCollections(timestamp); });

// --- Shared helpers (mirrored from the existing E2E suite's conventions) ---

async function createTestRequest(page: Page, collectionName: string) {
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

// Wait for the workspace + sidebar to be ready (same readiness waits as cookies-tab.spec.ts).
async function waitForAppReady(page: Page) {
  await expect(page.locator('.workspace-selector-trigger:not([disabled])')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(page.locator('.workspace-selector-label')).not.toHaveText('No Workspace', { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .loading-spinner')).not.toBeVisible({ timeout: 10000 });
}

// Open the Auth tab of the currently-open request and launch the cookie manager.
async function openCookieManager(page: Page) {
  await page.locator('.request-tabs').getByRole('button', { name: 'Auth' }).click();
  const openBtn = page.locator('[data-testid="open-cookie-manager"]');
  await expect(openBtn).toBeVisible({ timeout: 5000 });
  await openBtn.click();
  await expect(page.locator('[data-testid="cookie-manager-modal"]')).toBeVisible({ timeout: 5000 });
}

// Fill the first visible prompt modal and confirm. Returns once it has closed.
async function fillPrompt(page: Page, value: string) {
  const promptModal = page.locator('.prompt-modal');
  await expect(promptModal).toBeVisible({ timeout: 5000 });
  await promptModal.locator('.prompt-input').fill(value);
  await promptModal.locator('.prompt-btn-confirm').click();
  await expect(promptModal).not.toBeVisible({ timeout: 5000 });
}

test.describe('Cookie Manager dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Clear any cookie jar left over from a previous test in this browser context,
    // then reload so the store re-reads the now-empty jar from localStorage.
    await page.evaluate(() => localStorage.removeItem('pu_cookie_jar'));
    await page.reload();
    await waitForAppReady(page);
  });

  test('add domain, add/edit/remove cookie, search, persist, remove domain', async ({ page }) => {
    const collectionName = uniqueName('Cookie Manager Collection');
    await createTestRequest(page, collectionName);

    // a + b — open the manager via the Auth tab.
    await openCookieManager(page);

    // c — add a domain via the prompt.
    await page.locator('[data-testid="cookie-add-domain"]').click();
    await fillPrompt(page, COOKIE_DOMAIN);

    const domainItem = page.locator('[data-testid="cookie-domain-item"]').filter({ hasText: COOKIE_DOMAIN });
    await expect(domainItem).toBeVisible({ timeout: 5000 });

    // d — add a cookie. The dialog chains two prompts (name → value), so the
    // name prompt is replaced by the value prompt rather than closing — don't
    // assert it disappears between them; instead wait for the value prompt.
    await domainItem.locator('[data-testid="cookie-add-cookie"]').click();
    const namePrompt = page.locator('.prompt-modal');
    await expect(namePrompt).toBeVisible({ timeout: 5000 });
    await namePrompt.locator('.prompt-input').fill('sid'); // cookie name
    await namePrompt.locator('.prompt-btn-confirm').click();

    const valuePrompt = page.locator('.prompt-modal');
    await expect(valuePrompt).toContainText('Value for', { timeout: 5000 });
    await valuePrompt.locator('.prompt-input').fill('abc123'); // cookie value
    await valuePrompt.locator('.prompt-btn-confirm').click();
    await expect(page.locator('.prompt-modal')).not.toBeVisible({ timeout: 5000 });

    const sidTag = domainItem.locator('[data-testid="cookie-tag"]').filter({ hasText: 'sid' });
    await expect(sidTag).toBeVisible({ timeout: 5000 });

    // e — edit the cookie value via the textarea editor.
    await sidTag.click();
    const valueEditor = page.locator('[data-testid="cookie-value-editor"]');
    await expect(valueEditor).toBeVisible({ timeout: 5000 });
    await valueEditor.fill('newval');
    await page.locator('[data-testid="cookie-value-save"]').click();
    await expect(valueEditor).not.toBeVisible({ timeout: 5000 });

    // f — persistence: reload, reopen request → Auth tab → cookie manager.
    await page.reload();
    await waitForAppReady(page);

    const requestItem = page.locator('.request-item').filter({ hasText: 'New Request' }).first();
    await expect(requestItem).toBeVisible({ timeout: 10000 });
    await requestItem.click();
    await expect(page.locator('.request-editor')).toBeVisible({ timeout: 5000 });

    await openCookieManager(page);

    const domainItemAfter = page.locator('[data-testid="cookie-domain-item"]').filter({ hasText: COOKIE_DOMAIN });
    await expect(domainItemAfter).toBeVisible({ timeout: 5000 });
    await expect(
      domainItemAfter.locator('[data-testid="cookie-tag"]').filter({ hasText: 'sid' })
    ).toBeVisible({ timeout: 5000 });

    // g — search filters domain items; empty state shows when nothing matches.
    const search = page.locator('[data-testid="cookie-search"]');
    await search.fill('zzz-no-match-zzz');
    await expect(page.locator('[data-testid="cookie-empty"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="cookie-domain-item"]')).toHaveCount(0);

    // Clearing the search brings the domain back.
    await search.fill('');
    await expect(domainItemAfter).toBeVisible({ timeout: 5000 });

    // h — remove the cookie, then the domain (confirm dialog).
    await domainItemAfter.locator('[data-testid="cookie-remove-cookie"]').first().click();
    await expect(
      domainItemAfter.locator('[data-testid="cookie-tag"]').filter({ hasText: 'sid' })
    ).toHaveCount(0, { timeout: 5000 });

    // Removing the last cookie may already drop the domain row (per store behavior).
    // If the row still exists, remove the domain explicitly via its remove button.
    if (await domainItemAfter.isVisible().catch(() => false)) {
      await domainItemAfter.locator('[data-testid="cookie-remove-domain"]').click();
      const confirmModal = page.locator('.confirm-modal');
      await expect(confirmModal).toBeVisible({ timeout: 5000 });
      await confirmModal.locator('.confirm-btn-confirm').click();
      await expect(confirmModal).not.toBeVisible({ timeout: 5000 });
    }

    await expect(
      page.locator('[data-testid="cookie-domain-item"]').filter({ hasText: COOKIE_DOMAIN })
    ).toHaveCount(0, { timeout: 5000 });
  });

  // Add a domain + a cookie, then add a cookie via the chained name → value prompts.
  // The value prompt contains "Value for" (per the existing test's prompt-handling pattern).
  async function addCookie(page: Page, domainItem: Locator, name: string, value: string) {
    await domainItem.locator('[data-testid="cookie-add-cookie"]').first().click();
    const namePrompt = page.locator('.prompt-modal');
    await expect(namePrompt).toBeVisible({ timeout: 5000 });
    await namePrompt.locator('.prompt-input').fill(name);
    await namePrompt.locator('.prompt-btn-confirm').click();

    const valuePrompt = page.locator('.prompt-modal');
    await expect(valuePrompt).toContainText('Value for', { timeout: 5000 });
    await valuePrompt.locator('.prompt-input').fill(value);
    await valuePrompt.locator('.prompt-btn-confirm').click();
    await expect(page.locator('.prompt-modal')).not.toBeVisible({ timeout: 5000 });
  }

  // GH-57 item 4 — structural tag/editor layout.
  // The value editor must be a single shared element rendered OUTSIDE the cookie tags,
  // not one editor per tag and not nested inside a tag.
  test('value editor is a single shared element rendered outside cookie tags', async ({ page }) => {
    const collectionName = uniqueName('Cookie Manager Layout Collection');
    await createTestRequest(page, collectionName);

    await openCookieManager(page);

    // Add a fresh domain.
    await page.locator('[data-testid="cookie-add-domain"]').click();
    await fillPrompt(page, COOKIE_DOMAIN);

    const domainItem = page
      .locator('[data-testid="cookie-domain-item"]')
      .filter({ hasText: COOKIE_DOMAIN });
    await expect(domainItem).toBeVisible({ timeout: 5000 });

    // Add the first cookie.
    await addCookie(page, domainItem, 'sid', 'abc123');
    const sidTag = domainItem.locator('[data-testid="cookie-tag"]').filter({ hasText: 'sid' });
    await expect(sidTag).toBeVisible({ timeout: 5000 });

    // No editor exists before any tag is clicked.
    await expect(page.locator('[data-testid="cookie-value-editor"]')).toHaveCount(0);

    // Capture the tag count so we can assert opening the editor does not change it.
    const tagCountBefore = await page.locator('[data-testid="cookie-tag"]').count();

    // Click the tag to open the editor.
    await sidTag.click();

    // Exactly ONE editor exists in the whole DOM.
    await expect(page.locator('[data-testid="cookie-value-editor"]')).toHaveCount(1);

    // The editor is NOT a descendant of any cookie-tag.
    await expect(
      page.locator('[data-testid="cookie-tag"] [data-testid="cookie-value-editor"]')
    ).toHaveCount(0);

    // Opening the editor does not change the number of cookie tags.
    await expect(page.locator('[data-testid="cookie-tag"]')).toHaveCount(tagCountBefore);

    // Add a second cookie to the same domain.
    await addCookie(page, domainItem, 'token', 'xyz789');
    const tokenTag = domainItem.locator('[data-testid="cookie-tag"]').filter({ hasText: 'token' });
    await expect(tokenTag).toBeVisible({ timeout: 5000 });

    // Open the first tag's editor, then switch to the second tag.
    await sidTag.click();
    await expect(page.locator('[data-testid="cookie-value-editor"]')).toHaveCount(1);
    await tokenTag.click();

    // Still exactly ONE editor in the DOM — a single shared editor, not one per tag.
    await expect(page.locator('[data-testid="cookie-value-editor"]')).toHaveCount(1);
    await expect(
      page.locator('[data-testid="cookie-tag"] [data-testid="cookie-value-editor"]')
    ).toHaveCount(0);
  });
});
