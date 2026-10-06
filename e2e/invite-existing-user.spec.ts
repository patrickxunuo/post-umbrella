import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
test.use({ storageState: { cookies: [], origins: [] } });

// Real local Supabase + the deployed/local actual Edge Function; never route/mock.
test.describe('GH-77 existing account workspace membership', () => {
  test('adds an existing account, preserves role, and remains idempotent', async ({ request }) => {
    const url = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
    expect(new URL(url).hostname, 'These destructive fixtures require local Supabase').toMatch(/^(localhost|127\.0\.0\.1)$/);
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(key, 'SUPABASE_SERVICE_ROLE_KEY is required for isolated local fixtures').toBeTruthy();
    const client = createClient(url, key!, { auth: { persistSession: false } });
    const prefix = `gh77-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const password = `${prefix}-Password!9`;
    const users: string[] = []; let workspaceId: string | undefined;
    try {
      const callerEmail = `${prefix}-admin@example.com`;
      const targetEmail = `${prefix}-member@example.com`;
      for (const [email, role] of [[callerEmail, 'admin'], [targetEmail, 'developer']]) {
        const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
        expect(error).toBeNull(); users.push(data.user!.id);
        const profile = await client.from('user_profiles').upsert({ user_id: data.user!.id, email, role, status: 'active' });
        expect(profile.error).toBeNull();
      }
      const workspace = await client.from('workspaces').insert({ name: prefix, created_by: users[0] }).select().single();
      expect(workspace.error).toBeNull(); workspaceId = workspace.data.id;
      expect((await client.from('workspace_members').insert({ user_id: users[0], workspace_id: workspaceId, added_by: users[0] })).error).toBeNull();
      const anon = process.env.VITE_SUPABASE_ANON_KEY;
      expect(anon).toBeTruthy();
      const caller = createClient(url, anon!, { auth: { persistSession: false } });
      const login = await caller.auth.signInWithPassword({ email: callerEmail, password });
      expect(login.error).toBeNull();
      const endpoint = process.env.INVITE_USER_ENDPOINT || `${url}/functions/v1/invite-user`;
      expect(new URL(endpoint).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
      const invoke = () => request.post(endpoint, { headers: { Authorization: `Bearer ${login.data.session!.access_token}`, apikey: anon! }, data: { email: targetEmail, role: 'reader', workspaceIds: [workspaceId] } });
      const response = await invoke();
      expect(response.status(), await response.text()).toBe(200);
      expect(await response.json()).toMatchObject({ action: 'added', role: 'developer', workspace_names: [prefix], workspaces: [workspaceId] });
      const profile = await client.from('user_profiles').select('role').eq('user_id', users[1]).single();
      expect(profile.data!.role).toBe('developer');
      const membership = await client.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('user_id', users[1]);
      expect(membership.data).toHaveLength(1);
      const again = await invoke();
      expect(again.status(), await again.text()).toBe(400);
      expect((await again.json()).message).toMatch(/already.*member/i);
      expect((await client.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('user_id', users[1])).data).toHaveLength(1);
    } finally {
      if (workspaceId) {
        await client.from('workspace_members').delete().eq('workspace_id', workspaceId);
        await client.from('workspaces').delete().eq('id', workspaceId);
      }
      for (const id of users.reverse()) {
        await client.from('user_profiles').delete().eq('user_id', id);
        await client.auth.admin.deleteUser(id);
      }
    }
  });
});


for (const scenario of ['admin-add', 'disabled', 'developer'] as const) {
  test(`real UI ${scenario}: immediate feedback and final result`, async ({ page, context }) => {
    const url = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anon = process.env.VITE_SUPABASE_ANON_KEY;
    expect(service).toBeTruthy(); expect(anon).toBeTruthy();
    const client = createClient(url, service!, { auth: { persistSession: false } });
    const prefix = `gh77-ui-${scenario}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const password = `${prefix}-Password!9`;
    const callerEmail = `${prefix}-caller@example.com`;
    const targetEmail = `${prefix}-target@example.com`;
    const users: string[] = []; const workspaces: string[] = [];
    try {
      for (const [email, role, status] of [[callerEmail, scenario === 'developer' ? 'developer' : 'admin', 'active'], [targetEmail, 'developer', scenario === 'disabled' ? 'disabled' : 'active']]) {
        const created = await client.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull(); users.push(created.data.user!.id);
        expect((await client.from('user_profiles').upsert({ user_id: created.data.user!.id, email, role, status })).error).toBeNull();
      }
      for (const name of ['Alpha', 'Beta']) {
        const inserted = await client.from('workspaces').insert({ name: `${prefix}-${name}`, created_by: users[0] }).select().single();
        expect(inserted.error).toBeNull(); workspaces.push(inserted.data.id);
      }
      expect((await client.from('workspace_members').insert([
        { user_id: users[0], workspace_id: workspaces[1], added_by: users[0] },
        { user_id: users[1], workspace_id: workspaces[0], added_by: users[0] },
      ])).error).toBeNull();
      expect((await client.from('user_active_workspace').upsert([
        { user_id: users[0], workspace_id: workspaces[1] },
        { user_id: users[1], workspace_id: workspaces[0] },
      ])).error).toBeNull();
      const caller = createClient(url, anon!, { auth: { persistSession: false } });
      const login = await caller.auth.signInWithPassword({ email: callerEmail, password });
      expect(login.error).toBeNull();
      const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
      await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: storageKey, session: login.data.session });
      await page.goto('/');
      await page.locator('.btn-admin').click();
      const modal = page.locator(scenario === 'developer' ? '.invite-modal' : '.user-management');
      await expect(modal).toBeVisible();
      if (process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: `test-results/screenshots/gh77-${scenario}-opened.png` });
      const email = modal.getByTestId('invite-email');
      const submit = modal.getByTestId('invite-submit');
      await email.fill(targetEmail.toUpperCase());
      if (process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: `test-results/screenshots/gh77-${scenario}-before-submit.png` });
      // Real network latency keeps the pending window observable; no API response is mocked.
      const network = await context.newCDPSession(page);
      await network.send('Network.enable');
      await network.send('Network.emulateNetworkConditions', { offline: false, latency: 750, downloadThroughput: -1, uploadThroughput: -1 });
      let inviteRequests = 0;
      page.on('request', request => {
        if (request.url().includes('invite-user') && request.method() === 'POST') inviteRequests++;
      });
      const responsePromise = page.waitForResponse(response => response.url().includes('invite-user') && response.request().method() === 'POST');
      await submit.click();
      // No route interception: observe the request-in-flight indicator on the real service.
      await expect(submit).toBeDisabled();
      await expect(submit).toContainText(/Inviting/i);
      // Attempt repeat form submissions even though the normal submit button is disabled.
      await submit.evaluate(button => {
        const form = (button as HTMLButtonElement).form!;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      if (process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: `test-results/screenshots/gh77-${scenario}-pending.png` });
      if (scenario === 'admin-add') {
        await modal.locator('.modal-close').click();
        await expect(modal).not.toBeVisible();
        if (process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/screenshots/gh77-closed-while-pending.png' });
      }
      const response = await responsePromise;
      await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      if (scenario === 'admin-add') {
        expect(response.status(), await response.text()).toBe(200);
        await expect(page.getByText(`Added ${targetEmail} to ${prefix}-Beta`, { exact: true })).toBeVisible();
        // Completion is delivered globally after closing; reopening reads the added member.
        await page.locator('.btn-admin').click();
        await expect(modal).toBeVisible();
        const row = modal.locator('.user-row').filter({ hasText: targetEmail });
        await expect(row).toBeVisible();
        await expect(row.locator('.col-role')).toContainText(/developer/i);
        await expect(email).toHaveValue('');
        expect(inviteRequests).toBe(1);
        if (process.env.PAPERPLANE_CAPTURE_SCREENSHOTS !== '0') await page.screenshot({ path: 'test-results/screenshots/gh77-added-row.png', fullPage: true });
        // Retry demonstrates retained form/error ownership and no duplicate backend writes.
        await email.fill(targetEmail);
        const retryPromise = page.waitForResponse(r => r.url().includes('invite-user') && r.request().method() === 'POST');
        await submit.click();
        expect((await retryPromise).status()).toBe(400);
        await expect(page.getByText(/already a member of the workspace/i)).toBeVisible();
        await expect(email).toHaveValue(targetEmail);
        await expect(submit).toBeEnabled();
        expect(inviteRequests).toBe(2);
        await modal.locator('.modal-close').click();
        await expect(modal).not.toBeVisible();
        await page.reload();
        await page.locator('.btn-admin').click();
        await expect(row).toBeVisible();
        await expect(row.locator('.col-role')).toContainText(/developer/i);
        await expect(email).toHaveValue('');
        expect(inviteRequests).toBe(2);
        if (process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/screenshots/gh77-reloaded-membership.png' });
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
        await expect(page.getByText(scenario === 'disabled' ? /account is disabled/i : /already has an account.*workspace admin/i)).toBeVisible();
        await expect(email).toHaveValue(targetEmail.toUpperCase());
        await expect(submit).toBeEnabled();
        expect(inviteRequests).toBe(1);
      }
      const profile = await client.from('user_profiles').select('role,status').eq('user_id', users[1]).single();
      expect(profile.error).toBeNull();
      expect(profile.data).toEqual({ role: 'developer', status: scenario === 'disabled' ? 'disabled' : 'active' });
      const active = await client.from('user_active_workspace').select('workspace_id').eq('user_id', users[1]).single();
      expect(active.data?.workspace_id).toBe(workspaces[0]);
      const membership = await client.from('workspace_members').select('workspace_id').eq('user_id', users[1]).eq('workspace_id', workspaces[1]);
      expect(membership.error).toBeNull(); expect(membership.data).toHaveLength(scenario === 'admin-add' ? 1 : 0);
      if (process.env.PAPERPLANE_CAPTURE_SCREENSHOTS !== '0') {
        await page.screenshot({ path: `test-results/screenshots/gh77-${scenario}.png`, fullPage: true });
      }
    } finally {
      for (const id of users) await client.from('user_active_workspace').delete().eq('user_id', id);
      for (const id of workspaces) {
        await client.from('workspace_members').delete().eq('workspace_id', id);
        await client.from('workspaces').delete().eq('id', id);
      }
      for (const id of users.reverse()) {
        await client.from('user_profiles').delete().eq('user_id', id);
        await client.auth.admin.deleteUser(id);
      }
    }
  });
}
