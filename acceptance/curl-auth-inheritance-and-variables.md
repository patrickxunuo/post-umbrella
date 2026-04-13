# Acceptance Spec: cURL Preview Honors Inherited Auth and All Variables

## Problem
The "Copy as cURL" panel (`src/components/CurlPanel.jsx`) generates a cURL string that diverges from what `useResponseExecution.js` actually sends in two cases:

1. **Inherited auth** — A request with `auth_type === 'inherit'` is passed verbatim to `generateCurl`, which only recognizes `auth_type === 'bearer'`. Result: no `Authorization` header emitted, even though the actual request would carry the ancestor collection's Bearer token.
2. **Variable tokens** — A request whose `auth_token` is `{{api_key}}` is substituted using env vars only, missing collection variables entirely. Result: unresolved `{{api_key}}` leaks into the cURL output when the value lives in collection variables.

## Scope
Change only `src/components/CurlPanel.jsx` (and minimally, its consumer that passes context — likely `src/App.jsx` where CurlPanel is mounted). Do not change `generateCurl` in `RequestEditor.jsx`.

Out of scope:
- Other auth types (only `bearer` is supported today; `inherit` must resolve to the ancestor's actual type, currently only bearer is meaningful).
- Live collection-var refreshes via realtime (static read at panel compute time is fine — matches how `activeEnvironment` is read).

## Interface Contract

### New helper (inlined in CurlPanel)
```js
// Walks up the collection chain to find the nearest explicit (non-inherit, non-none) auth.
// Mirrors resolveInheritedAuth in useResponseExecution.js.
function resolveInheritedAuth(collectionId, collections) {
  let currentId = collectionId;
  let iterations = 0;
  while (currentId && iterations < 50) {
    const col = collections.find(c => c.id === currentId);
    if (!col) break;
    if (col.auth_type && col.auth_type !== 'none' && col.auth_type !== 'inherit') {
      return { auth_type: col.auth_type, auth_token: col.auth_token || '' };
    }
    currentId = col.parent_id;
    iterations++;
  }
  return { auth_type: 'none', auth_token: '' };
}
```

### Updated substitution
`sub(text)` in `CurlPanel.jsx` must:
1. Apply **collection variables first** (lower priority), using `\{\{\s*key\s*\}\}` (whitespace-tolerant regex — matches execution hook).
2. Apply **env variables second** (higher priority, overrides collection vars).
3. Use `variable.value || variable.current_value || variable.initial_value || ''` for collection vars (matches execution hook line 181).
4. Treat `variable.enabled === false` as "skip"; only include enabled vars.

### New data the panel must read
From `useWorkbench()` (already in `WorkbenchContext`):
- `collections` — already available on the context (full tree with `auth_type`, `auth_token`, `parent_id`).
- `collectionVariables` — the list for the current root collection.

If `collectionVariables` is not currently exposed on `useWorkbench()`, add it (load via `data.getCollectionVariables(rootCollectionId)` in an effect, keyed on `currentRootCollectionId`). Prefer reusing existing context state over spinning up a new fetch inside `CurlPanel`.

### Updated `curlPreview` computation
Replace the current `useMemo` body with (pseudocode):

```js
const req = /* existing */;
if (!req) return '';

// 1. Resolve inherited auth
let authType = req.auth_type || 'none';
let authToken = req.auth_token || '';
if (authType === 'inherit' && req.collection_id && collections) {
  const resolved = resolveInheritedAuth(req.collection_id, collections);
  authType = resolved.auth_type;
  authToken = resolved.auth_token;
}

// 2. Build sub() that applies collection vars (lower) then env vars (higher)
const sub = (text) => { /* per contract above */ };

// 3. Apply sub to url, headers, body, form data keys/text values, and authToken
// 4. Call generateCurl with the RESOLVED authType + substituted authToken
```

For examples (`activeTab.type === 'example'`):
- `req` still comes from `selectedExample.request_data`.
- Example request_data doesn't carry `collection_id`; use `selectedExample.request_id` → find parent request in collections → use that request's `collection_id` for auth inheritance. If not findable, fall back to current behavior (no resolution).

## Acceptance Criteria

### AC1 — Inherited auth resolves to parent's bearer token
Given a collection `C` with `auth_type = 'bearer'`, `auth_token = 'parent-token'`, and a request `R` inside `C` with `auth_type = 'inherit'`, the cURL preview MUST include:
```
-H 'Authorization: Bearer parent-token'
```

### AC2 — Inherited auth walks up multiple levels
Given nested collections `Root → Child` where `Root.auth_type = 'bearer'`, `Root.auth_token = 'root-token'`, `Child.auth_type = 'inherit'`, and request `R` in `Child` with `auth_type = 'inherit'`, the cURL preview MUST include `Authorization: Bearer root-token`.

### AC3 — Inherited auth with no ancestor = no Authorization header
Given a request with `auth_type = 'inherit'` whose ancestors all have `auth_type = 'none'` (or no explicit auth), the cURL preview MUST NOT include any `-H 'Authorization: ...'` line generated from auth (headers the user typed manually are unaffected).

### AC4 — Env variable in token is substituted
Given `activeEnvironment.variables` contains `{ key: 'api_key', value: 'env-val', enabled: true }` and a request with `auth_type = 'bearer'`, `auth_token = '{{api_key}}'`, the cURL preview MUST include `Authorization: Bearer env-val`.

### AC5 — Collection variable in token is substituted
Given a collection variable `{ key: 'api_key', value: 'col-val', enabled: true }` (no env var by the same key) and a request with `auth_type = 'bearer'`, `auth_token = '{{api_key}}'`, the cURL preview MUST include `Authorization: Bearer col-val`.

### AC6 — Env vars override collection vars
Given both a collection variable and an env variable with key `api_key` (values `col-val` and `env-val`), the cURL preview MUST include `Authorization: Bearer env-val`.

### AC7 — Inherited token that is itself a variable is substituted
Given `Collection.auth_type = 'bearer'`, `Collection.auth_token = '{{api_key}}'`, request with `auth_type = 'inherit'`, and a collection variable `api_key = 'col-val'`, cURL MUST include `Authorization: Bearer col-val`.

### AC8 — Whitespace in variable pattern is tolerated
`{{ api_key }}` (with spaces) MUST substitute identically to `{{api_key}}`.

### AC9 — Regression: plain bearer auth unchanged
Given a request with `auth_type = 'bearer'`, `auth_token = 'literal-token'` (no variables, no inheritance), the cURL output is unchanged from current behavior.

### AC10 — Regression: duplicate Authorization header prevention still works
If the user manually added an `Authorization` header AND auth_type resolves to bearer, the existing dedup logic in `generateCurl` (`headers.filter(...)` at RequestEditor.jsx:67) continues to skip the manual header, so only one `Authorization` line appears.

## Test Plan

### E2E test — `e2e/curl-panel.spec.ts` (new file)
Playwright scenarios (against the real app, following project convention of no mocking):

1. **curl-inherited-auth** — Create collection with Bearer token, create request inside with `Inherit auth`, send once so the cURL panel is meaningful, open cURL panel, assert panel content includes `Authorization: Bearer <token>`.
2. **curl-env-variable-token** — Create env var `api_key=env-123`, activate env, create request with bearer token `{{api_key}}`, open cURL panel, assert `Bearer env-123`.
3. **curl-collection-variable-token** — Create collection variable `api_key=col-456`, create request with bearer token `{{api_key}}` (no env var), open cURL panel, assert `Bearer col-456`.
4. **curl-env-overrides-collection** — Set both collection var and env var with same key, assert env value wins in cURL output.

Data-testid additions: add `data-testid="curl-panel-code"` to the CurlPanel CodeMirror container (the `<div className="curl-panel-code">` wrapper at line 132). Tests read `textContent` from this element.

Use the existing `e2e/helpers/cleanup.ts` pattern (`cleanupTestCollections(timestamp)` in `afterAll`).

### Regression
Re-run `e2e/collection-auth.spec.ts`, `e2e/environment.spec.ts`, `e2e/collection-variables.spec.ts`. They must all pass unchanged.
