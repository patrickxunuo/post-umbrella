import { describe, it, expect, beforeEach, vi } from 'vitest';

// GH-62 Part 1 — pm.collectionVariables.set() must auto-create an undeclared key.
//
// Root cause: updateCollectionVariableCurrentValues() only upserts a per-user
// current_value for collection variables that ALREADY have a row in
// collection_variables. A key that exists only in a script has nowhere to be
// stored, so `if (!variableId) continue;` silently drops it — {{token}} stays
// unresolved. The environment scope auto-creates on set; the collection scope
// must match. This test drives that behavior against a fake Supabase backed by
// in-memory tables, so it fails (red) on the unfixed code.

const h = vi.hoisted(() => {
  let db = {};
  let idCounter = 0;
  const uuid = () =>
    `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

  const matchRow = (row, filters) =>
    filters.every(([col, val, kind]) =>
      kind === 'in' ? val.includes(row[col]) : row[col] === val
    );

  const exec = (ctx) => {
    const rows = (db[ctx.table] = db[ctx.table] || []);
    if (ctx.op === 'select') {
      const data = rows.filter((r) => matchRow(r, ctx.filters));
      return { data: ctx.single ? data[0] || null : data, error: null };
    }
    if (ctx.op === 'insert' || ctx.op === 'upsert') {
      const items = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
      const out = [];
      for (const item of items) {
        let existing = null;
        if (ctx.op === 'upsert' && ctx.opts?.onConflict) {
          const keys = ctx.opts.onConflict.split(',');
          existing = rows.find((r) => keys.every((k) => r[k] === item[k]));
        }
        if (existing) {
          Object.assign(existing, item);
          out.push(existing);
        } else {
          const row = { id: item.id || uuid(), ...item };
          rows.push(row);
          out.push(row);
        }
      }
      const data = ctx.single ? out[0] : out;
      return { data: ctx.selectCols ? data : null, error: null };
    }
    if (ctx.op === 'delete') {
      db[ctx.table] = rows.filter((r) => !matchRow(r, ctx.filters));
      return { data: null, error: null };
    }
    if (ctx.op === 'update') {
      rows
        .filter((r) => matchRow(r, ctx.filters))
        .forEach((r) => Object.assign(r, ctx.payload));
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };

  const makeBuilder = (table) => {
    const ctx = {
      table,
      op: 'select',
      filters: [],
      payload: null,
      selectCols: null,
      single: false,
      opts: null,
    };
    const builder = {
      select(cols) { ctx.selectCols = cols; return builder; },
      eq(col, val) { ctx.filters.push([col, val]); return builder; },
      in(col, vals) { ctx.filters.push([col, vals, 'in']); return builder; },
      order() { return builder; },
      single() { ctx.single = true; return builder; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; return builder; },
      upsert(p, opts) { ctx.op = 'upsert'; ctx.payload = p; ctx.opts = opts; return builder; },
      update(p) { ctx.op = 'update'; ctx.payload = p; return builder; },
      delete() { ctx.op = 'delete'; return builder; },
      then(resolve, reject) {
        return Promise.resolve().then(() => exec(ctx)).then(resolve, reject);
      },
    };
    return builder;
  };

  const fakeSupabase = {
    from: (table) => makeBuilder(table),
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: 'user-1', email: 'u@test.dev' },
            expires_at: 9999999999,
          },
        },
        error: null,
      }),
    },
  };

  return {
    fakeSupabase,
    reset: () => { db = {}; idCounter = 0; },
    getTable: (name) => db[name] || [],
    seed: (name, rows) => { db[name] = rows; },
  };
});

vi.mock('./client.js', () => ({
  supabase: h.fakeSupabase,
  PROXY_FUNCTION_URL: '',
}));

import {
  updateCollectionVariableCurrentValues,
  getCollectionVariables,
} from './collectionVars.js';

const COLLECTION_ID = 'col-1';

describe('GH-62 Part 1: collection variables auto-create on script set', () => {
  beforeEach(() => {
    h.reset();
  });

  it('creates a collection_variables row for an undeclared key set from a script', async () => {
    // No `token` declared in the Variables tab.
    await updateCollectionVariableCurrentValues(COLLECTION_ID, { token: 'abc123' });

    const declared = h.getTable('collection_variables');
    const tokenVar = declared.find((v) => v.key === 'token');
    expect(tokenVar).toBeTruthy();
    expect(tokenVar.collection_id).toBe(COLLECTION_ID);
  });

  it('stores the script value as the per-user current_value for the new key', async () => {
    await updateCollectionVariableCurrentValues(COLLECTION_ID, { token: 'abc123' });

    const tokenVar = h.getTable('collection_variables').find((v) => v.key === 'token');
    const userValue = h
      .getTable('collection_variable_user_values')
      .find((uv) => uv.variable_id === tokenVar.id && uv.user_id === 'user-1');
    expect(userValue?.current_value).toBe('abc123');
  });

  it('a newly set undeclared key resolves via getCollectionVariables (so {{token}} substitutes)', async () => {
    await updateCollectionVariableCurrentValues(COLLECTION_ID, { token: 'abc123' });

    const vars = await getCollectionVariables(COLLECTION_ID);
    const tokenVar = vars.find((v) => v.key === 'token');
    expect(tokenVar).toBeTruthy();
    expect(tokenVar.value).toBe('abc123');
  });

  it('still updates the current_value of an already-declared key', async () => {
    h.seed('collection_variables', [
      { id: 'var-existing', collection_id: COLLECTION_ID, key: 'host', initial_value: 'old', enabled: true, sort_order: 0 },
    ]);

    await updateCollectionVariableCurrentValues(COLLECTION_ID, { host: 'new-host' });

    // No duplicate declaration created.
    const hostRows = h.getTable('collection_variables').filter((v) => v.key === 'host');
    expect(hostRows).toHaveLength(1);

    const userValue = h
      .getTable('collection_variable_user_values')
      .find((uv) => uv.variable_id === 'var-existing' && uv.user_id === 'user-1');
    expect(userValue?.current_value).toBe('new-host');
  });
});
