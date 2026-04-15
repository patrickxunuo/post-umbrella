# Acceptance Spec: Postman Import/Export Round-Trip Repair (PR #1 of 3 for #30)

## Problem
Our Postman v2.1 export emits only method, URL, headers, body, and examples. It silently drops auth, pre/post scripts, collection variables, inherit semantics, and folder-level auth. Our import likewise drops script events, non-bearer auth types, and maps collection-level variables to a separate Environment rather than to collection variables. Round-tripping an exported file through the importer loses half the user's work with no warning.

## Scope

### In
- `src/data/supabase/sync.js` — `buildPostmanRequest` + `buildPostmanCollection`
- `src/data/supabase/collectionVars.js` or equivalent — export needs to read collection variables (create a helper if not exposed)
- `supabase/functions/import-collection/index.ts` — `parseCollection` + field mappers + warnings accumulator
- `src/hooks/useRequestActions.js` — `handleImport` consumes `warnings[]` from the response
- `src/components/AppModals.jsx` (or wherever the import toast fires) — display warnings
- `e2e/fixtures/imports/` (new) + a new E2E spec covering round-trip

### Out
- Format picker UI (PR #2)
- Foreign templating detection / Insomnia tag handling (PR #2)
- Workflows export/import (deferred)
- OAuth2 handling (reject with warning, don't try to import)
- OpenAPI (PR #3)
- UI redesign — reuse the existing import modal, only the result toast changes

## Interface Contract

### 1. Export — `buildPostmanRequest(req, examples, parentAuth)`

Signature adds `parentAuth` so the function can emit `auth: null` (Postman's inherit marker) only when the parent actually has an auth to inherit.

```js
function buildPostmanRequest(req, examples, parentAuth) {
  const postman = {
    name: req.name,
    request: {
      method: req.method,
      header: (req.headers || []).map(h => ({
        key: h.key,
        value: h.value,
        disabled: h.enabled === false,
      })),
      url: { raw: req.url, ...parseUrl(req.url) },
    },
    response: /* existing examples mapping */,
  };

  // Body — unchanged from current behavior
  if (req.body && req.body_type !== 'none') {
    postman.request.body = { ... };
  }

  // Auth
  if (req.auth_type === 'bearer' && req.auth_token) {
    postman.request.auth = {
      type: 'bearer',
      bearer: [{ key: 'token', value: req.auth_token, type: 'string' }],
    };
  } else if (req.auth_type === 'inherit') {
    // Postman convention: omit `auth` entirely, or emit null. We emit nothing —
    // omitting the field means "inherit" when a parent has auth.
    // No-op here.
  } else if (req.auth_type === 'none' && parentAuth) {
    // User explicitly set "No Auth" on a request that has an auth ancestor.
    // Postman represents this as { type: 'noauth' }.
    postman.request.auth = { type: 'noauth' };
  }

  // Scripts — Postman event[] with listen: 'prerequest' | 'test'
  const event = [];
  if (req.pre_script) {
    event.push({
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: req.pre_script.split('\n') },
    });
  }
  if (req.post_script) {
    event.push({
      listen: 'test',
      script: { type: 'text/javascript', exec: req.post_script.split('\n') },
    });
  }
  if (event.length > 0) postman.event = event;

  return postman;
}
```

### 2. Export — `buildPostmanCollection(collection, allCollections, allRequests, allExamples, allCollectionVariables, parentAuth)`

Root collection also emits:
- `auth` (same shape as request-level, when `collection.auth_type === 'bearer'`)
- `event` (collection pre/post scripts, same shape)
- `variable` (our collection_variables for the root, as `[{key, value, type: 'string'}]`)

Nested folders:
- `auth`, `event` passed through where present on the folder
- `variable` NOT emitted on folders (our collection variables are root-scoped)

Inheritance threading:
- Pass an `effectiveAuth` down the recursion so child requests can decide whether to emit `auth: null` (inherit meaningful) vs skip (no parent auth exists).

```js
function buildPostmanCollection(collection, allCollections, allRequests, allExamples, allVariables, parentAuth = null) {
  const myAuth = (collection.auth_type === 'bearer' && collection.auth_token)
    ? { type: 'bearer', bearer: [{ key: 'token', value: collection.auth_token, type: 'string' }] }
    : collection.auth_type === 'inherit' ? null /* inherit parent */ : undefined;
  const effectiveAuth = myAuth === undefined ? parentAuth : (myAuth === null ? parentAuth : myAuth);

  const collectionRequests = allRequests.filter(r => r.collection_id === collection.id);
  const childCollections = allCollections.filter(c => c.parent_id === collection.id);

  const items = [
    ...collectionRequests.map(req => buildPostmanRequest(req, allExamples.filter(e => e.request_id === req.id), effectiveAuth)),
    ...childCollections.map(child => {
      // Recursive folder
      const inner = buildPostmanCollection(child, allCollections, allRequests, allExamples, allVariables, effectiveAuth);
      return {
        name: child.name,
        item: inner.item,
        ...(inner.auth ? { auth: inner.auth } : {}),
        ...(inner.event ? { event: inner.event } : {}),
      };
    }),
  ];

  const result = {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
  };

  if (myAuth && myAuth !== null) result.auth = myAuth;
  const event = [];
  if (collection.pre_script) event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: collection.pre_script.split('\n') } });
  if (collection.post_script) event.push({ listen: 'test', script: { type: 'text/javascript', exec: collection.post_script.split('\n') } });
  if (event.length > 0) result.event = event;

  // Root-only: emit collection variables
  if (!collection.parent_id && Array.isArray(allVariables) && allVariables.length > 0) {
    result.variable = allVariables
      .filter(v => v.enabled !== false && v.key)
      .map(v => ({ key: v.key, value: v.value || v.initial_value || '', type: 'string' }));
  }

  return result;
}
```

`exportCollection(id)` loads `allVariables` via a new helper (e.g., `getCollectionVariables(rootId)`) and passes it in. If the helper doesn't exist for this use case, add it inline — no new module required.

### 3. Import — Edge Function `parseCollection`

Recursion signature adds `parentHasAuth: boolean` and a `warnings: string[]` accumulator.

Auth mapping:
```ts
function parseAuth(
  auth: any,
  parentHasAuth: boolean,
  warnings: string[],
  context: string
): { auth_type: string; auth_token: string } {
  if (!auth) {
    // Undefined / null auth on an item whose parent has auth → inherit
    return parentHasAuth
      ? { auth_type: 'inherit', auth_token: '' }
      : { auth_type: 'none', auth_token: '' };
  }
  if (auth.type === 'noauth') return { auth_type: 'none', auth_token: '' };
  if (auth.type === 'bearer' && Array.isArray(auth.bearer)) {
    const tokenItem = auth.bearer.find((b: any) => b.key === 'token');
    return { auth_type: 'bearer', auth_token: tokenItem?.value || '' };
  }
  if (auth.type === 'apikey') {
    // Map to a header (when in=header) or leave a warning for query-location key
    warnings.push(`${context}: API Key auth is not natively supported — imported as a plain header. Manual review recommended.`);
    // Best-effort: inject a header into the request (caller handles this; here we just return 'none')
    return { auth_type: 'none', auth_token: '' };
  }
  if (auth.type === 'basic') {
    warnings.push(`${context}: Basic auth is not supported yet — dropped.`);
    return { auth_type: 'none', auth_token: '' };
  }
  if (auth.type === 'oauth2' || auth.type === 'oauth1') {
    warnings.push(`${context}: OAuth auth is not supported — dropped. You'll need to configure auth manually.`);
    return { auth_type: 'none', auth_token: '' };
  }
  warnings.push(`${context}: Unknown auth type "${auth.type}" — dropped.`);
  return { auth_type: 'none', auth_token: '' };
}
```

For API Key `in: header`, the parser should additionally inject the header into the request's header list rather than dropping it silently. Spec-level: if `auth.type === 'apikey'` and `auth.apikey.find(a => a.key === 'in').value === 'header'`, push a header `{ key: <keyName>, value: <keyValue>, enabled: true }` into the request's headers AND leave `auth_type = 'none'`. That way the request actually works post-import. Record a warning so the user knows what happened.

Script mapping:
```ts
function parseEvents(event: any[] | undefined): { pre_script: string; post_script: string } {
  if (!Array.isArray(event)) return { pre_script: '', post_script: '' };
  let pre_script = '';
  let post_script = '';
  for (const ev of event) {
    const code = Array.isArray(ev?.script?.exec) ? ev.script.exec.join('\n') : (ev?.script?.exec || '');
    if (ev.listen === 'prerequest') pre_script = code;
    else if (ev.listen === 'test') post_script = code;
  }
  return { pre_script, post_script };
}
```

`parseCollection` applies this at both folder level (writes to the `collections` table's `pre_script` / `post_script` columns — add columns if missing; they exist since v0.1.8) and request level.

Collection-level `variable`:
- Currently creates a separate Environment. Change: when importing the ROOT collection, write variables to `collection_variables` (table exists since v0.1.8) keyed to the root collection id. Do NOT create an environment.
- Schema: `{ collection_id: rootId, key, initial_value, enabled: true, sort_order: idx }`.
- Warning emitted: `"Imported N collection variables into collection '<name>'."` (informational).
- **Breaking change flag**: the old behavior created an environment. Call this out prominently in the PR description and CHANGELOG.

### 4. Warning channel

Edge Function response shape extends:
```ts
{
  success: true,
  rootCollectionId,
  collectionsCount,
  requestsCount,
  environment: null,                   // No longer used (collection vars path)
  warnings: string[],                  // NEW — user-facing messages
}
```

Client `importCollection` returns the full response unchanged. `handleImport` in `useRequestActions.js`:
```js
const result = await data.importCollection(postmanData, workspaceId);
if (result.warnings?.length > 0) {
  toast.warning(`Imported with ${result.warnings.length} warning(s). Click for details.`, {
    action: () => showImportWarningsModal(result.warnings),
  });
} else {
  toast.success(`Imported "${rootCollection.name}"`);
}
```

`showImportWarningsModal` can be a simple `ConfirmModal` invocation with `listItems` (the prop we added for the tab context menu PR #28). Title: `Import Warnings`. Confirm text: `OK`, no cancel.

### 5. Params field
Currently imported as `params: '[]'` verbatim. URLs already carry query strings; leave params empty — the URL is the source of truth. No change needed here; call it out so reviewers don't "fix" it.

## Acceptance Criteria

### AC1 — Bearer auth round-trips
Given a request with `auth_type='bearer'` and `auth_token='abc'`, exporting produces `request.auth = { type: 'bearer', bearer: [{key:'token', value:'abc', type:'string'}] }`. Re-importing yields the same `auth_type` and `auth_token`.

### AC2 — `auth_type='inherit'` round-trips
Given a collection with `auth_type='bearer'` and a child request with `auth_type='inherit'`, export emits the collection's `auth` field AND omits `auth` on the request. Re-import sets the request's `auth_type` back to `'inherit'` because `parentHasAuth` is true.

### AC3 — Pre/post scripts round-trip
A request with `pre_script='console.log(1)'` and `post_script='pm.test(...)'` exports to `event: [{listen:'prerequest',...}, {listen:'test',...}]` with the exec array containing the script split by `\n`. Re-import restores the scripts byte-identically. Same at the collection/folder level.

### AC4 — Collection variables round-trip to collection variables
Root collection with 3 collection variables `{api_key, base_url, timeout}` exports as `variable: [{key,value,type:'string'}, ...]`. Re-import creates those as COLLECTION variables on the imported root collection. No new environment is created.

### AC5 — API Key auth best-effort
A Postman file with `auth: { type: 'apikey', apikey: [{key:'key',value:'X-API-Key'}, {key:'value',value:'secret'}, {key:'in',value:'header'}] }` imports as a request with `X-API-Key: secret` added to its header list AND `auth_type='none'`. A warning is emitted listing the mapping.

### AC6 — Unsupported auth types are warned, not silently dropped
`basic`, `oauth1`, `oauth2` each produce a warning like `"<request name>: Basic auth is not supported yet — dropped."` and `auth_type='none'`. NO silent drop.

### AC7 — Warnings surface in UI
Given an import with warnings, the user sees a toast saying `"Imported with N warning(s)."` that opens a modal listing each warning. Given an import with NO warnings, the toast is the standard success.

### AC8 — No regression in existing behavior
- Existing Postman collections (with just methods + URLs + headers + bodies) still import identically.
- Duplicate collection name still rejects with the existing error message.
- Partial-failure rollback still fires on request insert failure.
- cURL import modal is unchanged.

### AC9 — Round-trip E2E proves persistence
A fixture Postman file covering auth (bearer, inherit, none), scripts, collection variables, and nested folders exports → reimports → diffing the persisted state shows no drift in the fields above.

### AC10 — Breaking change documented
The PR description + CHANGELOG entry prominently note: "Postman `variable[]` at the collection level now imports as collection variables (v0.1.8 feature) instead of a separate environment."

## Test Plan

### Unit-ish (Deno tests on the Edge Function)
Not required for this PR if the project doesn't already test Edge Functions — verify by E2E.

### E2E — new file `e2e/fixtures/imports/postman-v2.1-roundtrip.json`
A hand-crafted Postman v2.1 file containing:
- Root collection name: `RT Postman Test <timestamp>` (use a placeholder; actual timestamp injected by fixture helper)
- Root collection with: bearer auth + pre_script + post_script + 2 collection variables
- 3 nested folders (2 levels deep)
- 5 requests with varied auth: bearer, inherit, noauth, apikey(header), basic
- 1 request with pre/post scripts

### E2E test — `e2e/import-roundtrip.spec.ts`
1. **roundtrip-postman-v2.1** — load the fixture, import via the existing modal, open the created collection, assert: root has the 2 collection variables; a request in a nested folder shows `auth_type='bearer'` inherited from the root; a request with explicit bearer shows its token; a request with scripts has them populated. Then click the "Export" action, compare the exported JSON against the fixture — allow for UUID differences but assert structural equality on `auth`, `event`, `variable`, folder hierarchy.
2. **import-warnings-surface** — import a fixture containing `auth: basic` and `auth: oauth2`. Assert a toast appears with "N warnings", click it, assert a modal with the warning strings opens.
3. **import-apikey-header** — import a fixture with `auth.apikey` + `in: header`. Assert the resulting request has the header added AND a warning was emitted.

### Regression (must still pass unchanged)
- `e2e/import.spec.ts` (existing Postman import test)
- Any existing cURL import test
- `e2e/collection-auth.spec.ts` (auth inheritance continues to work post-import)
- `e2e/collection-variables.spec.ts` (collection variables feature continues to work — just the import path changes its behavior, not the runtime feature)
