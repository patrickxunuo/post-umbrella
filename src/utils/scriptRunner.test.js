import { describe, it, expect } from 'vitest';
import { applyCollectionVariableUpdates, executeScript } from './scriptRunner';
import { substituteEnv, substituteUrl } from './substituteVariables';

// GH-59: A variable first CREATED inside a pre-request script (pm.variables.set)
// must be substituted into the outgoing request — headers, URL, body, params —
// even when there is NO active environment. pm.variables is Postman's transient
// "local" scope; it must not depend on (or leak into) the persisted environment.
describe('GH-59: pre-request script local variables resolve in substitution', () => {
  // Mirror what the request-execution hook does: run the pre-script, gather the
  // local variables it set, then substitute them into the outgoing request.
  async function runPreScriptAndSubstitute(
    script,
    text,
    { environment = null, collectionVariables = [] } = {}
  ) {
    const result = await executeScript(script, { environment, collectionVariables });
    const localVariables = result.varUpdates || {};
    return substituteEnv(text, { environment, collectionVariables, localVariables });
  }

  it('resolves a header var first created in the pre-script with NO active environment', async () => {
    const resolved = await runPreScriptAndSubstitute(
      'pm.variables.set("token", "abc123");',
      'Bearer {{token}}',
      { environment: null }
    );
    expect(resolved).toBe('Bearer abc123');
  });

  it('exposes pm.variables.set values via executeScript varUpdates', async () => {
    const result = await executeScript('pm.variables.set("token", "abc123");', {
      environment: null,
    });
    expect(result.varUpdates).toBeDefined();
    expect(result.varUpdates.token).toBe('abc123');
  });

  it('substituteEnv applies localVariables to arbitrary text', () => {
    expect(substituteEnv('Bearer {{token}}', { localVariables: { token: 'abc123' } })).toBe(
      'Bearer abc123'
    );
  });

  it('substituteUrl applies localVariables', () => {
    expect(
      substituteUrl('https://api.test/{{path}}', { localVariables: { path: 'users' } })
    ).toBe('https://api.test/users');
  });

  it('local variables take precedence over env and collection variables', () => {
    const out = substituteEnv('{{token}}', {
      environment: { variables: [{ key: 'token', current_value: 'env-val', enabled: true }] },
      collectionVariables: [{ key: 'token', value: 'col-val', enabled: true }],
      localVariables: { token: 'local-val' },
    });
    expect(out).toBe('local-val');
  });

  it('pm.variables.set is transient — it does NOT leak into the persisted environment scope', async () => {
    const result = await executeScript('pm.variables.set("token", "abc123");', {
      environment: null,
    });
    // Local scope only — must not be reported as an environment update to persist.
    expect(result.envUpdates.token).toBeUndefined();
    expect(result.varUpdates.token).toBe('abc123');
  });

  it('pm.environment.set still reports an env update to persist', async () => {
    const result = await executeScript('pm.environment.set("token", "abc123");', {
      environment: null,
    });
    expect(result.envUpdates.token).toBe('abc123');
  });

  it('pm.variables.get reads back a value set earlier in the same script', async () => {
    const result = await executeScript(
      'pm.variables.set("a", "1"); if (pm.variables.get("a") !== "1") throw new Error("readback failed");',
      { environment: null }
    );
    expect(result.success).toBe(true);
  });

  it('pm.variables.unset removes a seeded local var from varUpdates (propagates across scripts)', async () => {
    const result = await executeScript('pm.variables.unset("token");', {
      environment: null,
      localVariables: { token: 'abc123' },
    });
    expect(result.varUpdates.token).toBeUndefined();
  });

  it('an empty/whitespace script preserves the seeded local scope', async () => {
    const result = await executeScript('   ', {
      environment: null,
      localVariables: { token: 'abc123' },
    });
    expect(result.varUpdates.token).toBe('abc123');
  });

  it('a later script sees a local var set by an earlier script via the seed', async () => {
    const first = await executeScript('pm.variables.set("token", "abc123");', { environment: null });
    const second = await executeScript(
      'if (pm.variables.get("token") !== "abc123") throw new Error("seed not visible");',
      { environment: null, localVariables: first.varUpdates }
    );
    expect(second.success).toBe(true);
  });

  it('predefined env vars still resolve and a pre-script-created var resolves alongside them', () => {
    const out = substituteEnv('{{base}}/{{token}}', {
      environment: { variables: [{ key: 'base', current_value: 'https://api', enabled: true }] },
      localVariables: { token: 'abc123' },
    });
    expect(out).toBe('https://api/abc123');
  });
});

// GH-62 Part 1: pm.collectionVariables.set() must auto-create undeclared keys —
// parity with applyEnvironmentUpdates so the new key resolves in the request.
describe('GH-62: applyCollectionVariableUpdates (collection-scope create-on-set)', () => {
  it('appends a brand-new collection variable set from a script', () => {
    const out = applyCollectionVariableUpdates([], { token: 'abc123' });
    const tokenVar = out.find(v => v.key === 'token');
    expect(tokenVar).toBeTruthy();
    expect(tokenVar.current_value).toBe('abc123');
    expect(tokenVar.initial_value).toBe('');
    expect(tokenVar.enabled).toBe(true);
  });

  it('a newly created var resolves in substitution via the value field', () => {
    const updated = applyCollectionVariableUpdates([], { token: 'abc123' });
    expect(substituteEnv('Bearer {{token}}', { collectionVariables: updated })).toBe('Bearer abc123');
  });

  it('updates the current_value of an already-declared collection variable', () => {
    const existing = [{ key: 'host', initial_value: 'old', current_value: 'old', value: 'old', enabled: true }];
    const out = applyCollectionVariableUpdates(existing, { host: 'new' });
    const hostVar = out.find(v => v.key === 'host');
    expect(hostVar.current_value).toBe('new');
    expect(out.filter(v => v.key === 'host')).toHaveLength(1);
    // Does not mutate the input array.
    expect(existing[0].current_value).toBe('old');
  });

  it('a null update clears the current_value but keeps the declaration', () => {
    const existing = [{ key: 'host', initial_value: 'fallback', current_value: 'live', value: 'live', enabled: true }];
    const out = applyCollectionVariableUpdates(existing, { host: null });
    const hostVar = out.find(v => v.key === 'host');
    expect(hostVar).toBeTruthy();
    expect(hostVar.current_value).toBe('');
    expect(hostVar.value).toBe('fallback');
  });

  it('an empty-string update clears the current_value and falls back to initial_value (parity with persistence)', () => {
    const existing = [{ key: 'host', initial_value: 'fallback', current_value: 'live', value: 'live', enabled: true }];
    const out = applyCollectionVariableUpdates(existing, { host: '' });
    const hostVar = out.find(v => v.key === 'host');
    expect(hostVar.current_value).toBe('');
    expect(hostVar.value).toBe('fallback');
  });

  it('returns the list unchanged when there are no updates', () => {
    const existing = [{ key: 'host', value: 'x', enabled: true }];
    expect(applyCollectionVariableUpdates(existing, {})).toEqual(existing);
  });

  it('end-to-end: a pre-script that sets an undeclared collection var resolves in the request', async () => {
    const result = await executeScript('pm.collectionVariables.set("token", "abc123");', {
      environment: null,
      collectionVariables: [],
    });
    const collectionVariables = applyCollectionVariableUpdates([], result.collectionVarUpdates);
    expect(substituteEnv('Bearer {{token}}', { collectionVariables })).toBe('Bearer abc123');
  });
});
