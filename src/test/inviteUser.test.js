// @vitest-environment node
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { describe, it, expect, vi } from 'vitest';

async function fixture({ existing = { user_id: 'existing', email: 'member@example.com', role: 'developer', status: 'active' }, caller = 'admin', memberships = [], memberError = null, lookupError = null } = {}) {
  const writes = []; const queries = [];
  const auth = { inviteUserByEmail: vi.fn().mockResolvedValue({ data: { user: { id: 'new-user' } } }), createUser: vi.fn(), generateLink: vi.fn(), deleteUser: vi.fn() };
  const client = { auth: { admin: auth }, from(table) {
    let filters = []; let operation = 'select'; let payload;
    const query = {
      select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
      in(key, value) { filters.push([key, value]); return query; },
      ilike(key, value) { filters.push([key, value]); queries.push({ table, key, value, method: 'ilike' }); return query; },
      insert(value) { operation = 'insert'; payload = value; writes.push({ table, operation, payload }); return query; },
      upsert(value) { operation = 'upsert'; payload = value; writes.push({ table, operation, payload }); return query; },
      update(value) { operation = 'update'; payload = value; writes.push({ table, operation, payload }); return query; },
      single() { return query; }, maybeSingle() { return query; }, limit() { return query; },
      then(resolve, reject) {
        let data = null; let error = null;
        if (operation !== 'select') {
          data = payload;
          if (table === 'workspace_members') error = memberError;
        } else if (table === 'user_profiles') {
          const isCaller = filters.some(([k, v]) => k === 'user_id' && v === 'caller');
          data = isCaller ? { role: caller, status: 'active' } : existing;
          if (!isCaller) error = lookupError;
        } else if (table === 'workspace_members') {
          data = filters.some(([k,v]) => k === 'user_id' && v === 'caller') ? [{ workspace_id: 'ws-a' }, { workspace_id: 'ws-b' }] : memberships;
        } else if (table === 'workspaces') {
          const ids = filters.find(([key]) => key === 'id')?.[1];
          data = [{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }].filter(w => !ids || ids.includes(w.id));
        }
        return Promise.resolve({ data, error }).then(resolve, reject);
      },
    };
    return query;
  } };
  let handler;
  const source = readFileSync(new URL('../../supabase/functions/invite-user/index.ts', import.meta.url), 'utf8').replace(/^import .*createClient.*;\r?\n/m, '');
  const { code } = await transform(source, { loader: 'ts', target: 'es2022' });
  new Function('Deno', 'createClient', code)(
    { serve(fn) { handler = fn; }, env: { get: () => '' } },
    (_url, _key, options) => options ? { auth: { getUser: async () => ({ data: { user: { id: 'caller' } } }) } } : client,
  );
  const request = (body = {}, authorized = true) => handler(new Request('http://local/invite-user', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify({ email: 'member@example.com', role: 'reader', workspaceIds: ['ws-a'], ...body }) }));
  return { request, writes, auth, queries };
}

describe('GH-77 invite-user handler', () => {
  it('adds an existing active account without changing its global role or sending an invite', async () => {
    const { request, writes, auth } = await fixture();
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, action: 'added', user_id: 'existing', email: 'member@example.com', role: 'developer', email_sent: false, workspaces: ['ws-a'], workspace_names: ['Alpha'] });
    expect(writes.some(w => w.table === 'workspace_members' && JSON.stringify(w.payload).includes('existing'))).toBe(true);
    expect(writes.filter(w => w.table === 'user_profiles')).toEqual([]);
    expect(Object.values(auth).every(fn => fn.mock.calls.length === 0)).toBe(true);
  });
  it('does not write duplicate memberships and reports only newly added workspaces', async () => {
    const { request, writes } = await fixture({ caller: 'system', memberships: [{ workspace_id: 'ws-a', added_by: 'original', added_at: '2020-01-01' }] });
    const response = await request({ workspaceIds: ['ws-a', 'ws-b', 'ws-b'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: 'added', workspaces: ['ws-b'], workspace_names: ['Beta'] });
    const members = writes.filter(w => w.table === 'workspace_members').flatMap(w => w.payload);
    expect(members.map(m => m.workspace_id)).toEqual(['ws-b']);
  });
  it('rejects adding an inactive account', async () => {
    const { request, writes } = await fixture({ existing: { user_id: 'existing', role: 'developer', status: 'disabled' } });
    const response = await request();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await response.json()).message).toMatch(/disabled/i);
    expect(writes).toEqual([]);
  });
  it('does not report success when membership persistence fails', async () => {
    const { request } = await fixture({ memberError: { message: 'database unavailable' } });
    expect((await request()).status).toBe(500);
  });
  it('retains invitation delivery for a new address', async () => {
    const { request, auth } = await fixture({ existing: null });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: 'invited', email_sent: true, role: 'reader' });
    expect(auth.inviteUserByEmail).toHaveBeenCalledOnce();
  });

  it('preserves pending status and active workspace without profile writes', async () => {
    const existing = { user_id: 'existing', email: 'member@example.com', role: 'reader', status: 'pending', active_workspace_id: 'ws-b' };
    const snapshot = { ...existing };
    const { request, writes, auth } = await fixture({ existing });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: 'added', status: 'pending', email_sent: false });
    expect(existing).toEqual(snapshot);
    expect(writes.filter(w => w.table === 'user_profiles')).toEqual([]);
    expect(Object.values(auth).every(fn => fn.mock.calls.length === 0)).toBe(true);
  });
  it.each(['admin', 'system'])('rejects all-existing targets without writes (%s)', async caller => {
    const { request, writes } = await fixture({ caller, memberships: [{ workspace_id: 'ws-a', added_by: 'original' }] });
    const response = await request();
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/already.*member/i);
    expect(writes).toEqual([]);
  });
  it('explains developer existing-account restriction without writes', async () => {
    const { request, writes, auth } = await fixture({ caller: 'developer' });
    const response = await request();
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body.message).toMatch(/already.*account/i);
    expect(body.message).toMatch(/workspace admin/i);
    expect(writes).toEqual([]);
    expect(Object.values(auth).every(fn => fn.mock.calls.length === 0)).toBe(true);
  });
  it('rejects mixed authorized and foreign admin targets before writing', async () => {
    const { request, writes } = await fixture();
    expect((await request({ workspaceIds: ['ws-a', 'private'] })).status).toBe(403);
    expect(writes).toEqual([]);
  });
  it('fails safely on lookup errors rather than inviting duplicates', async () => {
    const { request, writes, auth } = await fixture({ existing: null, lookupError: { message: 'lookup unavailable' } });
    expect((await request()).status).toBe(500);
    expect(writes).toEqual([]);
    expect(Object.values(auth).every(fn => fn.mock.calls.length === 0)).toBe(true);
  });
  it('accepts mixed-case existing email without inviting', async () => {
    const { request, auth } = await fixture();
    const response = await request({ email: 'Member@Example.COM' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: 'added', user_id: 'existing', email_sent: false });
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });
  it('escapes email wildcard characters so lookup cannot match another account', async () => {
    const { request, queries } = await fixture({ existing: { user_id: 'literal', email: 'member_%@example.com', role: 'reader', status: 'active' } });
    const response = await request({ email: 'Member_%@Example.COM' });
    expect(response.status).toBe(200);
    expect(queries).toContainEqual({ table: 'user_profiles', key: 'email', method: 'ilike', value: String.raw`member\_\%@example.com` });
    expect(await response.json()).toMatchObject({ user_id: 'literal', email: 'member_%@example.com' });
  });
  it('requires authentication', async () => {
    const { request, writes } = await fixture();
    expect((await request({}, false)).status).toBe(401);
    expect(writes).toEqual([]);
  });
  it('preserves reader and developer permission boundaries', async () => {
    for (const options of [{ caller: 'reader' }, { caller: 'developer' }]) {
      const { request, writes } = await fixture(options);
      expect((await request({ role: 'admin' })).status).toBe(403);
      expect(writes).toEqual([]);
    }
  });
  it('filters workspace access and rejects wholly unauthorized selections', async () => {
    const { request, writes } = await fixture();
    expect((await request({ workspaceIds: ['private'] })).status).toBe(403);
    expect(writes).toEqual([]);
  });
});
