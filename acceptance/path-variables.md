# Acceptance Spec: Path Variables in Request URL

## Problem

Today the URL input only supports `{{env}}` / `{{collection}}` substitution. There is no Postman-style path variable concept (`/users/:id`). Real REST APIs are heavily path-templated, so users currently work around this by storing path segments as env vars — clumsy and not scoped to a single request.

Solution — add per-request **path variables** declared inline in the URL with `:name` syntax. Each `:name` token in the URL produces a row in a "Path Variables" list inside the Params tab (below the existing query params table). Keys are read-only in the list (edited only by editing the URL); values are editable directly or via the floating variable popover. Values may themselves reference `{{env}}` variables. Substitution applies to both the live request *and* the cURL preview.

## Scope

This spec covers **three sub-features** that ship in one PR (issue #38):

- **F1 (foundation, no UX change)** — Supabase migration adding `path_variables JSONB` to `requests`, data layer parses/stringifies it, and substitution logic is extracted into a single shared util used by `useResponseExecution.js`, `useWorkflowExecution.js`, and `CurlPanel.jsx`. The util gains a path-var pass even though no UI yet writes to `path_variables` (the column will be empty `[]` for existing rows; the pass is a no-op for them).

- **F2 (URL parsing UI)** — `RequestEditor.jsx` parses `:name` tokens from the URL on every change and reconciles the `pathVariables` array (add new, remove deleted, **preserve values** for surviving keys). New "Path Variables" section appears inside the Params tab below the query params table when `pathVariables.length > 0`. Reserved-character validation strips a `:` followed immediately by an invalid char. Save persists `path_variables`.

- **F3 (overlay highlight + popover)** — `EnvVariableInput` recognizes `:name` in addition to `{{var}}` when caller passes `pathVariables` prop (URL field only — headers/body/value cells stay env-only). Hover/click on `:name` opens the existing `VariablePopover` showing the path-var value, editable inline. Distinct accent color (proposing `--accent-success` green) so users can tell env (blue) / collection (orange) / path (green) at a glance.

Edit only:
- New: `supabase/migrations/{timestamp}_request_path_variables.sql`, `src/utils/substituteVariables.js`, `e2e/path-variables.spec.ts`
- Modified: `src/data/supabase/requests.js`, `src/hooks/useResponseExecution.js`, `src/hooks/useWorkflowExecution.js`, `src/components/CurlPanel.jsx`, `src/components/RequestEditor.jsx`, `src/components/EnvVariableInput.jsx`, `src/components/VariablePopover.jsx`, `src/styles/request-editor.css` (or `App.css`)

No new dependencies.

Out of scope:
- Path variables on the workflow level (workflows still execute requests with each request's own path vars).
- `pm.pathVariables.get/set` script API — defer.
- Autocomplete dropdown after typing `:` (no list of suggestions). The variable list updates as the URL is typed; that's enough for v1.
- Path variables in headers, body, or auth (path-var syntax only valid in the URL).
- Importing/exporting path variables in Postman/cURL/OpenAPI sync — defer (the URL string round-trips fine; values won't but that's a follow-up).

---

## F1 — Storage and Substitution Foundation

### Migration
File: `supabase/migrations/{NEW-TIMESTAMP}_request_path_variables.sql` (use timestamp `20260424000000` or current; format matches existing migrations).

```sql
-- Add path_variables column to requests
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS path_variables JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN requests.path_variables IS
  'Path variables declared inline in url via :name syntax. Array of {key, value}, order matches URL order.';
```

No RLS changes — column inherits row-level policies from the existing `requests` table.

### Data layer (`src/data/supabase/requests.js`)
Mirror the existing `params` pattern.

In `parseRequest`, add:
```js
path_variables: typeof request.path_variables === 'string'
  ? JSON.parse(request.path_variables || '[]')
  : (request.path_variables || []),
```

In `createRequest`'s insert payload, add:
```js
path_variables: request.path_variables ? JSON.stringify(request.path_variables) : '[]',
```

In `updateRequest`, add:
```js
if (updates.path_variables !== undefined) {
  updateData.path_variables = JSON.stringify(updates.path_variables);
}
```

Stored shape: `[{ "key": "id", "value": "42" }, ...]`. Order matters (mirrors URL order). No `enabled` flag — presence in array means active (per issue spec).

### Shared substitution util (NEW: `src/utils/substituteVariables.js`)

Replaces the three duplicated substitution functions. Single source of truth.

```js
// src/utils/substituteVariables.js

/**
 * Build the merged variable map (collection lower priority, env higher).
 * Returns a Map<string, string> ready for substitution.
 *
 * Single-pass merge avoids the bug where iterating two lists sequentially
 * means the second list can't override because the first already replaced
 * the {{key}} pattern.
 */
function buildEnvMap({ environment, collectionVariables }) {
  const resolved = new Map();
  if (collectionVariables) {
    for (const v of collectionVariables) {
      if (v.enabled === false || !v.key) continue;
      resolved.set(v.key, v.value ?? v.current_value ?? v.initial_value ?? '');
    }
  }
  if (environment?.variables) {
    for (const v of environment.variables) {
      if (v.enabled === false || !v.key) continue;
      resolved.set(v.key, v.value ?? v.current_value ?? v.initial_value ?? '');
    }
  }
  return resolved;
}

function applyEnvSubstitution(text, envMap) {
  if (!text) return text;
  let result = text;
  for (const [key, value] of envMap) {
    result = result.replace(new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, 'g'), value);
  }
  return result;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Substitute {{env}} and {{collection}} variables in arbitrary text.
 * Used for headers, body, auth, form-data, query params.
 */
export function substituteEnv(text, { environment, collectionVariables } = {}) {
  if (!text) return text;
  return applyEnvSubstitution(text, buildEnvMap({ environment, collectionVariables }));
}

/**
 * Substitute the URL: applies path variables first (with their values
 * env-resolved), THEN env substitution. This order matches the issue spec:
 *   1. Resolve {{env}} inside each path-var value
 *   2. Replace :name in URL
 *   3. Apply {{env}} to remaining URL text
 *
 * pathVariables: Array<{ key, value }>
 */
export function substituteUrl(url, { environment, collectionVariables, pathVariables } = {}) {
  if (!url) return url;
  const envMap = buildEnvMap({ environment, collectionVariables });

  let result = url;
  if (pathVariables && pathVariables.length > 0) {
    for (const pv of pathVariables) {
      if (!pv.key) continue;
      const resolvedValue = applyEnvSubstitution(pv.value || '', envMap);
      // Match :key as a token: must not be followed by another path-var-name char.
      // Allowed name chars: anything not in the reserved set (see PATH_VAR_RESERVED).
      // Use a negative lookahead so :foo does not greedily consume into :foobar.
      // BUT path-var keys are already exact strings, so the safest approach is
      // a word-boundary-ish regex: :KEY followed by end-of-string OR a reserved char.
      const pattern = new RegExp(
        `:${escapeRegex(pv.key)}(?=$|[/?#\\[\\]@!$&'()*+,;=\\s])`,
        'g'
      );
      result = result.replace(pattern, resolvedValue);
    }
  }
  // Then env substitution on whatever remains (e.g. {{baseUrl}} in the URL prefix).
  result = applyEnvSubstitution(result, envMap);
  return result;
}

/**
 * Reserved characters that terminate a path variable name.
 * RFC 3986 reserved chars + space + colon (a second colon ends the variable).
 *
 * NOTE: `.` is not reserved — `/api/v1.2/users/:id` is fine and `:id` will not
 * try to absorb `.`. But `.` IS allowed inside a path-var name if the user types
 * `:foo.bar` — the regex above terminates at reserved chars so `.bar` would be
 * INSIDE the name, which is correct.
 */
export const PATH_VAR_RESERVED = new Set([
  '/', '?', '#', '[', ']', '@',
  '!', '$', '&', "'", '(', ')', '*', '+', ',', ';', '=',
  ' ', ':',
]);

/**
 * Parse :name tokens out of a URL string in order.
 * Returns Array<{ key, start, end }> where start/end are character indexes.
 *
 * Key rules:
 * - Starts at a `:` that is not preceded by `:` (to skip `::`).
 * - Name is everything from after the `:` up to (but not including) the next
 *   reserved character or end-of-string.
 * - If the name is empty (i.e. `:` immediately followed by reserved char), it
 *   is NOT a valid path variable. The caller is responsible for stripping the
 *   stray `:` (see `sanitizeUrlForPathVars`).
 * - Duplicate keys produce one entry each but reconcile() dedupes by first
 *   occurrence (a path with `/users/:id/sub/:id` shows ONE row for `id`).
 */
export function extractPathVarTokens(url) {
  if (!url) return [];
  const tokens = [];
  let i = 0;
  while (i < url.length) {
    const ch = url[i];
    if (ch === ':' && url[i - 1] !== ':' && url[i + 1] !== ':') {
      // Find name end
      let j = i + 1;
      while (j < url.length && !PATH_VAR_RESERVED.has(url[j])) j++;
      if (j > i + 1) {
        tokens.push({ key: url.slice(i + 1, j), start: i, end: j });
        i = j;
        continue;
      }
    }
    i++;
  }
  return tokens;
}

/**
 * Strip stray `:` characters that are followed immediately by a reserved char
 * (or end-of-string). Per the issue spec: typing `/:/` should become `//`,
 * `/:?` becomes `/?`, etc.
 *
 * Note: a trailing `:` at the very end of the URL is NOT stripped (the user
 * may still be mid-typing the name). Reconciliation with the existing path-var
 * list will simply not produce a row for it yet.
 */
export function sanitizeUrlForPathVars(url) {
  if (!url) return url;
  let result = '';
  for (let i = 0; i < url.length; i++) {
    const ch = url[i];
    if (ch === ':') {
      const next = url[i + 1];
      // Strip if next char is a reserved char (NOT end-of-string — let the user keep typing)
      if (next !== undefined && PATH_VAR_RESERVED.has(next) && next !== ':') {
        // skip this colon
        continue;
      }
    }
    result += ch;
  }
  return result;
}

/**
 * Reconcile current path-variables list against the URL.
 * - For every token in the URL: if a key already exists in the list, keep its value.
 * - For every key in the list NOT in the URL: drop it.
 * - New keys appended in URL order with empty value.
 * - Duplicate keys in URL produce a single row (first occurrence wins).
 *
 * Pure function. Returns a new array.
 */
export function reconcilePathVariables(url, currentPathVars) {
  const tokens = extractPathVarTokens(url);
  const seen = new Set();
  const result = [];
  for (const t of tokens) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    const existing = currentPathVars?.find(pv => pv.key === t.key);
    result.push({ key: t.key, value: existing?.value || '' });
  }
  return result;
}
```

### Refactor existing call sites

**`src/hooks/useResponseExecution.js`** — replace lines 173–209 (`substituteWithEnv` block).

```js
import { substituteEnv, substituteUrl } from '../utils/substituteVariables';

// Caller already destructures pathVariables from the active tab/request:
const pathVariables = ...; // wired from RequestEditor save payload (F2)

const subEnv = (text) => substituteEnv(text, { environment: currentEnv, collectionVariables: collectionVars });
const resolvedUrl = substituteUrl(url, { environment: currentEnv, collectionVariables: collectionVars, pathVariables });

const resolvedHeaders = headers.map(h => ({ ...h, key: subEnv(h.key), value: subEnv(h.value) }));
const resolvedBody = subEnv(body);
const resolvedAuthToken = subEnv(authToken);
const resolvedFormData = formData?.map(f => ({
  ...f,
  key: subEnv(f.key),
  value: f.type === 'file' ? f.value : subEnv(f.value),
}));
```

`handleSendRequest` signature gains `pathVariables` parameter (default `[]`). Caller in `RequestEditor.jsx` passes the array on Send.

**`src/hooks/useWorkflowExecution.js`** — replace lines 138–155 (`substitute` block).

Workflow steps load each request fresh from DB (or use the dirty tab's data). Read `request.path_variables` for each step:

```js
import { substituteEnv, substituteUrl } from '../utils/substituteVariables';

const subEnv = (text) => substituteEnv(text, { environment: currentEnv, collectionVariables: collectionVars });
const resolvedUrl = substituteUrl(request.url, {
  environment: currentEnv,
  collectionVariables: collectionVars,
  pathVariables: request.path_variables || [],
});
```

This also fixes the pre-existing bug where the workflow's substitute() iterates collection then env separately, so env can never override a collection key with the same name. The shared util uses the merged-map pattern.

**`src/components/CurlPanel.jsx`** — replace lines 109–145 (`sub` block).

```js
import { substituteEnv, substituteUrl } from '../utils/substituteVariables';

const env = { environment: activeEnvironment, collectionVariables };
const sub = (text) => substituteEnv(text, env);
const subUrl = (url) => substituteUrl(url, { ...env, pathVariables: req.path_variables || [] });

// ...
return generateCurl(
  req.method || 'GET',
  subUrl(req.url || ''),
  headers,
  sub(req.body || ''),
  req.body_type || 'none',
  fd,
  authType,
  sub(authToken)
);
```

`activeTab.request` (the dirty editor state, when present) carries `path_variables` on every change so the cURL preview updates live as the user types `:id` and edits the value.

### F1 Acceptance Criteria

**AC-F1.1 — Migration applies cleanly**
- After `supabase db reset` (or `supabase migration up`), `requests` table has a `path_variables JSONB DEFAULT '[]'` column.
- Existing rows have `path_variables = []`.

**AC-F1.2 — Data layer round-trips path_variables**
- `createRequest({ path_variables: [{key:'id', value:'42'}] })` then `getRequest(id)` returns `path_variables` as `[{key:'id', value:'42'}]` (array, not string).
- `updateRequest(id, { path_variables: [...] })` persists.
- `updateRequest(id, {})` (no path_variables key) does NOT clobber the existing value.

**AC-F1.3 — substituteUrl applies path-vars before env**
- Given `url = '/users/:id'`, `pathVariables = [{key:'id', value:'42'}]`, no env: result = `/users/42`.
- Given `url = '/users/:id'`, `pathVariables = [{key:'id', value:'{{user_id}}'}]`, env `user_id = 42`: result = `/users/42`.
- Given `url = '{{baseUrl}}/users/:id'`, `pathVariables = [{key:'id', value:'42'}]`, env `baseUrl = 'https://api.example.com'`: result = `https://api.example.com/users/42`.

**AC-F1.4 — Path-var name regex respects reserved chars**
- `url = '/users/:id/posts'`, `pathVariables = [{key:'id', value:'42'}]` → `/users/42/posts` (the `/` after `:id` correctly terminates the name match).
- `url = '/users/:id'` (end-of-string) with `pathVariables = [{key:'id', value:'42'}]` → `/users/42`.
- `url = '/users/:id?x=1'` → `/users/42?x=1`.

**AC-F1.5 — Path-var matches don't bleed across names**
- `url = '/api/:foo/:foobar'`, `pathVariables = [{key:'foo', value:'A'}, {key:'foobar', value:'B'}]` → `/api/A/B` (NOT `/api/A/Abar`). The `(?=$|[reserved])` lookahead prevents `:foo` from matching `:foobar`'s prefix.

**AC-F1.6 — substituteEnv unchanged behavior**
- `substituteEnv('hello {{name}}', { environment: { variables: [{ key:'name', value:'world', enabled:true }] } })` = `'hello world'`.
- All existing E2E tests that exercise env / collection substitution continue to pass.

**AC-F1.7 — Workflow execution bug fix (free side benefit)**
- Given collection var `host = 'old.example.com'` and env var `host = 'new.example.com'` (env active), workflow request URL `https://{{host}}/users` now resolves to `https://new.example.com/users` (env wins). Before the refactor it resolved to `https://old.example.com/users` due to sequential-replacement bug.

**AC-F1.8 — Pure unit-style smoke test**
- Add `e2e/path-variables.spec.ts` that imports `substituteUrl` directly via Vite test runner OR uses Playwright `page.evaluate` to invoke it through the frontend bundle. Smoke-test the four cases above.
- (We don't have Vitest configured. Prefer adding the smoke as a Playwright test that triggers a Send and asserts on the resolved URL log line in the request console — see `useResponseExecution.js:254` `Resolved URL: ${resolvedUrl}` log.)

---

## F2 — URL Parsing and Path Variables Section

### `RequestEditor.jsx` state additions

After the existing `params` useState (around line 130):

```js
const [pathVariables, setPathVariables] = useState([]);
```

In the initialization effect (alongside `setParams(initializeParams(...))` around line 187 / 206):

```js
const initialPathVars = reqData.path_variables || request?.path_variables || [];
const reconciledPathVars = reconcilePathVariables(reqData.url || request?.url || '', initialPathVars);
setPathVariables(reconciledPathVars);
```

### URL change handler

Modify `handleUrlChange` (around line 232–252). After `setUrl(newUrl)`:

```js
const handleUrlChange = (rawUrl) => {
  // Strip stray `:` followed by reserved chars (e.g. typing `/:/` collapses to `//`)
  const sanitized = sanitizeUrlForPathVars(rawUrl);

  setUrl(sanitized);

  // Sync params from URL while preserving disabled params (existing logic, unchanged)
  const urlParams = parseUrlParams(sanitized);
  const disabledParams = params.filter(p => !p.enabled && p.key.trim());
  const mergedParams = [
    ...urlParams.filter(p => p.key.trim()),
    ...disabledParams,
  ];
  if (mergedParams.length === 0 || mergedParams[mergedParams.length - 1].key !== '') {
    mergedParams.push({ key: '', value: '', enabled: true });
  }
  setParams(mergedParams);

  // NEW: reconcile path vars
  const newPathVars = reconcilePathVariables(sanitized, pathVariables);
  setPathVariables(newPathVars);

  notifyChange({ url: sanitized, params: mergedParams, path_variables: newPathVars });
};
```

**Caret handling on sanitization:** if the user types `:` then immediately `/`, the `:` is removed from the sanitized URL. The native input's caret position will normally end up after the removed `:` — i.e. it stays at what is now the position right after the `/`. That matches what the user expects (typed two chars, second char "absorbed" the first). DO NOT manually setSelectionRange to override; the browser handles this fine. If Agent B observes flicker, defer caret correction to a `requestAnimationFrame`.

### Path Variables section UI

Inside the existing `activeDetailTab === 'params'` block (around line 620), AFTER the closing `</table>` of the params table:

```jsx
{pathVariables.length > 0 && (
  <div className="path-variables-section" data-testid="path-variables-section">
    <div className="path-variables-header">
      <span className="path-variables-title">Path Variables</span>
    </div>
    <table>
      <thead>
        <tr>
          <th style={{ width: '30px' }}></th>
          <th>Key</th>
          <th>Value</th>
          <th style={{ width: '40px' }}></th>
        </tr>
      </thead>
      <tbody>
        {pathVariables.map((pv) => (
          <tr key={pv.key} data-testid={`path-variable-row-${pv.key}`}>
            <td></td>
            <td>
              <input
                type="text"
                className="path-var-key-readonly"
                value={pv.key}
                readOnly
                tabIndex={-1}
                data-testid={`path-variable-key-${pv.key}`}
                title="Edit the URL above to change this key"
              />
            </td>
            <td>
              <EnvVariableInput
                value={pv.value}
                onChange={(e) => {
                  const updated = pathVariables.map(p =>
                    p.key === pv.key ? { ...p, value: e.target.value } : p
                  );
                  setPathVariables(updated);
                  notifyChange({ path_variables: updated });
                }}
                placeholder="Value"
                activeEnvironment={activeEnvironment}
                collectionVariables={collectionVariables}
                rootCollectionId={rootCollectionId}
                onEnvironmentUpdate={onEnvironmentUpdate}
                data-testid={`path-variable-value-input-${pv.key}`}
              />
            </td>
            <td>{/* no delete button — deletion via URL editing */}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

CSS (`src/styles/request-editor.css`, append):

```css
.path-variables-section {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--border-secondary);
}

.path-variables-header {
  padding: 0 var(--space-3) var(--space-2);
}

.path-variables-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.path-var-key-readonly {
  background: transparent;
  border: 1px solid transparent;
  cursor: default;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  width: 100%;
  padding: var(--space-2);
}

.path-var-key-readonly:focus {
  outline: none;
  border-color: var(--border-primary);
  background: var(--bg-input);
}
```

### Save persistence

Modify `handleSave` (around line 376–411). The `paramsToSave` block already filters params; after it, add:

```js
// Path variables: save as-is (already reconciled to URL on every keystroke).
// Trim values' {{var}} whitespace consistently with other vars.
const pathVarsToSave = pathVariables.map(pv => ({ ...pv, value: trimVars(pv.value) }));
```

Pass `path_variables: pathVarsToSave` in both `data.createRequest` and `data.updateRequest` payloads.

For example save (line ~411 area), include `path_variables: pathVarsToSave` likewise in `request_data`.

For the temporary-save path (around line 420), include `path_variables: pathVarsToSave`.

### Send request wires path_variables

In `handleSend` (early in the file, before line ~371): pass `pathVariables` into `onSend` payload.

```js
onSend({
  // ...existing fields
  pathVariables, // NEW
});
```

`useResponseExecution.handleSendRequest` accepts `pathVariables`, defaults `[]`, threads into `substituteUrl`.

The `Try` button (example mode, line ~503) also needs `pathVariables: example?.request_data?.path_variables || []`.

### `notifyChange` and `dirty` tracking

The existing `notifyChange` already accepts arbitrary fields and bubbles up. Add `path_variables` to the dirty-detection equality check (find where `params` is compared and mirror the same logic). Probably in `WorkbenchContext` or wherever `originalRequestsRef` is consulted.

### F2 Acceptance Criteria

**AC-F2.1 — Typing `:name` adds a row**
- URL field empty. Type `/users/:id`. After the keystroke that produces `d`, `[data-testid="path-variables-section"]` is visible and contains one row `[data-testid="path-variable-row-id"]` with key text `id` and empty value.

**AC-F2.2 — Typing `:` alone shows nothing**
- URL `/users/:`. No row. Section hidden (length 0).

**AC-F2.3 — Multiple path vars in URL order**
- URL `/users/:id/posts/:postId`. Two rows, in order `id` then `postId`.

**AC-F2.4 — Reserved char strips the `:`**
- URL field has `/users/`. Type `:` then `/` immediately. Final URL is `/users//`. No path-var row.
- Same with `:?`, `:#`, `:&`, `:=`, `: ` (space) — the `:` is stripped on commit.

**AC-F2.5 — Trailing `:` at end-of-string is preserved**
- URL `/users/:`. The `:` stays in the input (user is still typing). No row yet.
- Continue typing `id` → URL becomes `/users/:id` and the row appears.

**AC-F2.6 — Removing `:name` from URL removes the row**
- URL `/users/:id`. Backspace 3 times to leave `/users/`. The row disappears.

**AC-F2.7 — Renaming `:name` preserves value when char-adjacent**
- URL `/users/:id`, value set to `42`. Edit URL to `/users/:idx`. The old row `id` is gone, a new row `idx` exists with value `''`. (Renaming is an add+remove, NOT a rename — value does not migrate. This matches Postman.)

**AC-F2.8 — Editing key in the list is impossible**
- The `[data-testid="path-variable-key-{name}"]` input has the `readOnly` attribute. Attempting to type into it does not change its value.

**AC-F2.9 — Editing value in the list works**
- Click `[data-testid="path-variable-value-input-id"]` (it's an `EnvVariableInput`'s wrapped input). Type `42`. Value is `42`. Save the request.

**AC-F2.10 — Path variables persist across reload**
- Save a request with URL `/users/:id` and value `42`. Reload the page. Open the request. URL `/users/:id`, path-var row shows `id = 42`.

**AC-F2.11 — Send substitutes path var**
- Request URL `/post`, body `{}`, path-var-section absent. Send → request goes to `/post` (regression check).
- Change URL to `/post/:id`, set value `42`. Send → request goes to `/post/42`. The console log shows `Resolved URL: <full-url>/post/42`.

**AC-F2.12 — Path-var value can reference env var**
- Env active with `user_id = 99`. Request URL `/users/:id`, path-var value `{{user_id}}`. Send → resolved URL contains `/users/99`.

**AC-F2.13 — cURL preview matches**
- Open cURL panel for the request from AC-F2.12. Preview shows `curl ... '/users/99' ...`. Editing the value to `100` updates the preview live.

**AC-F2.14 — Duplicate `:name` in URL → single row**
- URL `/a/:id/b/:id`. Path Variables section has exactly ONE row for `id`. Setting value `42` resolves both occurrences: send → `/a/42/b/42`.

**AC-F2.15 — Section hidden when no path vars**
- URL `/api/users`. `[data-testid="path-variables-section"]` is NOT in the DOM (or has zero count).

**AC-F2.16 — Query params still work alongside path vars**
- URL `/users/:id?active=true`. Path Variables row `id`. Params row `active=true`. Both edit independently. Send substitutes `:id`, leaves `?active=true` alone.

---

## F3 — URL Overlay Highlight + Popover

### `EnvVariableInput.jsx` extension

Add an optional `pathVariables` prop. When provided AND non-empty, the overlay also recognizes `:name` tokens.

State changes: none. Prop addition only.

```js
export function EnvVariableInput({
  value, onChange, onKeyDown, onPaste, placeholder, className,
  activeEnvironment, collectionVariables, rootCollectionId, onEnvironmentUpdate,
  pathVariables, // NEW — optional. Only the URL field passes this.
  disabled = false,
}) {
```

Update `hasVariables` (line 70):

```js
const hasVariables = /\{\{[^}]+\}\}/.test(value) || (pathVariables?.length > 0 && /:/.test(value));
```

Update `findVariableAtPosition` (line 29) to also detect `:name`:

```js
const findVariableAtPosition = (text, pos) => {
  // First check {{var}} (existing)
  const envRegex = /\{\{([^}]+)\}\}/g;
  let match;
  while ((match = envRegex.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    if (pos >= start && pos <= end) {
      return { kind: 'env', name: match[1].trim(), start, end, fullMatch: match[0] };
    }
  }
  // Then check :name path vars (only if pathVariables prop supplied)
  if (pathVariables && pathVariables.length > 0) {
    const tokens = extractPathVarTokens(text); // import from substituteVariables.js
    for (const t of tokens) {
      if (pos >= t.start && pos <= t.end) {
        return { kind: 'path', name: t.key, start: t.start, end: t.end, fullMatch: text.slice(t.start, t.end) };
      }
    }
  }
  return null;
};
```

Update `renderHighlightedText` (line 254) to also style `:name` tokens. Easiest: split the text into segments using a combined regex.

```js
const renderHighlightedText = () => {
  if (!value) return null;
  const segments = [];
  let cursor = 0;

  // Build a list of all token spans (env + path)
  const tokens = [];
  const envRegex = /\{\{[^}]+\}\}/g;
  let m;
  while ((m = envRegex.exec(value)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, kind: 'env', text: m[0] });
  }
  if (pathVariables && pathVariables.length > 0) {
    for (const t of extractPathVarTokens(value)) {
      tokens.push({ start: t.start, end: t.end, kind: 'path', text: value.slice(t.start, t.end), name: t.key });
    }
  }
  tokens.sort((a, b) => a.start - b.start);

  for (const tok of tokens) {
    if (tok.start > cursor) segments.push({ text: value.slice(cursor, tok.start), isVar: false });
    segments.push({ text: tok.text, isVar: true, kind: tok.kind, name: tok.name });
    cursor = tok.end;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), isVar: false });

  return segments.map((seg, i) => {
    if (!seg.isVar) return <span key={i}>{seg.text}</span>;
    if (seg.kind === 'env') {
      const varName = seg.text.slice(2, -2).trim();
      const source = getVariableSource(varName);
      let varClass;
      if (!source && !activeEnvironment) varClass = 'no-env';
      else if (!source) varClass = 'unresolved';
      else if (source === 'collection') varClass = 'collection';
      else varClass = 'resolved';
      return <span key={i} className={`env-var-highlight ${varClass}`}>{seg.text}</span>;
    }
    // kind === 'path'
    const pv = pathVariables.find(p => p.key === seg.name);
    const varClass = pv?.value ? 'path-resolved' : 'path-unresolved';
    return <span key={i} className={`env-var-highlight ${varClass}`}>{seg.text}</span>;
  });
};
```

CSS (append to whichever stylesheet hosts `.env-var-highlight`):

```css
.env-var-highlight.path-resolved {
  background: color-mix(in srgb, var(--accent-success) 20%, transparent);
  color: var(--accent-success);
}

.env-var-highlight.path-unresolved {
  background: color-mix(in srgb, var(--accent-warning) 20%, transparent);
  color: var(--accent-warning);
  text-decoration: underline dotted;
}
```

If `color-mix` / `--accent-success` aren't available, fall back to `rgba(34, 197, 94, 0.2)` / `#22c55e`.

### `RequestEditor.jsx` URL input wires pathVariables prop

Modify the URL `EnvVariableInput` (line 490–502) to pass `pathVariables`:

```jsx
<EnvVariableInput
  className="url-input"
  // ...existing props
  pathVariables={pathVariables} // NEW
/>
```

The query-params value cells, headers, body, auth — **DO NOT** pass `pathVariables`. Path vars only render in the URL field.

### Hover popover wiring

`EnvVariableInput.handleMouseMove` (line 287) already calls `variablePopover.show({ varName, rect })`. For path vars, we need a separate path-var popover state.

Easiest approach — extend the existing `VariablePopover` to accept a `kind` parameter. Augment its `show()` API:

```js
// VariablePopover.jsx — show()
const show = useCallback(({ varName, rect, kind = 'env', pathVariables, onPathVarChange }) => {
  if (isEditing) { clearHideTimeout(); return; }
  // ... existing selection guard
  clearHideTimeout();
  if (kind === 'path') {
    const pv = pathVariables?.find(p => p.key === varName);
    setState({ varName, rect, kind: 'path', source: 'path', value: pv?.value || '', onPathVarChange });
    setEditValue(pv?.value || '');
  } else {
    const source = getVariableSource(varName);
    const value = getVariableValue(varName);
    setState({ varName, rect, kind: 'env', source, value });
    setEditValue(value || '');
  }
}, [isEditing, getVariableSource, getVariableValue, clearHideTimeout]);
```

`saveVariable()` adds a path-var branch:

```js
if (state.kind === 'path' && state.onPathVarChange) {
  state.onPathVarChange(state.varName, valueToSave);
  setIsEditing(false);
  setState(null);
  return;
}
// ...existing env/collection branches
```

`EnvVariableInput.handleMouseMove` checks the variable kind:

```js
const variable = findVariableAtPosition(value, charPos);
if (variable) {
  // ... existing rect math
  if (variable.kind === 'path') {
    variablePopover.show({
      varName: variable.name,
      rect: { ... },
      kind: 'path',
      pathVariables,
      onPathVarChange: (key, newValue) => {
        // Synthesize an onChange-like update by calling parent through a new prop:
        onPathVariableValueChange?.(key, newValue);
      },
    });
  } else {
    variablePopover.show({ varName: variable.name, rect: {...} });
  }
}
```

This adds `onPathVariableValueChange` as a new prop on `EnvVariableInput`, called only when a path-var hover popover edits a value. `RequestEditor` provides:

```jsx
<EnvVariableInput
  // ...
  pathVariables={pathVariables}
  onPathVariableValueChange={(key, newValue) => {
    const updated = pathVariables.map(p => p.key === key ? { ...p, value: newValue } : p);
    setPathVariables(updated);
    notifyChange({ path_variables: updated });
  }}
/>
```

Header rendering in the popover for path-var kind:

```js
{state.kind === 'path' && (
  <span className="env-var-name path">
    <span className="suggestion-source-badge path">P</span>
    {state.varName}
  </span>
)}
```

CSS for `.suggestion-source-badge.path` (matches existing env/collection badges):

```css
.suggestion-source-badge.path {
  background: var(--accent-success);
  color: white;
}
```

### F3 Acceptance Criteria

**AC-F3.1 — `:name` highlighted in URL input only**
- URL `/users/:id`. Visible `<span class="env-var-highlight path-resolved">` (or `path-unresolved` if value is empty) wrapping `:id` in the URL input overlay.
- Header value `:id`, body `:id`, query-param value `:id` — NO highlighting (the wrapping `EnvVariableInput`s don't pass `pathVariables`).

**AC-F3.2 — Path-var color distinct from env**
- `:id` shows green-ish accent. `{{token}}` shows blue accent. Visually distinguishable.

**AC-F3.3 — Hover opens popover**
- Hover `:id` in the URL input. Popover appears showing key `id`, source `Path`, current value, and "Click to edit" hint.

**AC-F3.4 — Click-to-edit changes value**
- Click the popover. Input field appears with current value. Type new value. Press Enter. Path Variables row reflects the new value.

**AC-F3.5 — Path-var name doesn't bleed**
- URL `/api/:foo/:foobar`. Hovering `:foo` opens popover for `foo` (NOT `foobar`). Hovering `:foobar` opens popover for `foobar`.

**AC-F3.6 — `{{var}}` popover still works**
- Hovering `{{baseUrl}}` in the URL still opens the env popover with the env value (regression check).

---

## Test Plan

### NEW: `e2e/path-variables.spec.ts`

Reuse `e2e/helpers/auth.ts` and the standard request-creation pattern from existing specs.

Test fixture: a public echo endpoint where the resolved path is reflected in the response body (so we can assert the substitution happened). `httpbin.org/anything/<path>` reflects the path in the JSON response under `url`.

1. **`f1-pure-substitute-url`** — Send request to `https://httpbin.org/anything/:id`, set path-var `id=42`. Assert response body's `url` field contains `/anything/42`.
2. **`f1-path-var-with-env-interp`** — Env active with `user_id=99`. URL `/anything/:id`, value `{{user_id}}`. Send. Response `url` contains `/anything/99`.
3. **`f2-typing-colon-adds-row`** — Open new request. Type `/anything/:id` in URL. Assert `[data-testid="path-variables-section"]` visible; row `path-variable-row-id` present.
4. **`f2-typing-just-colon-no-row`** — URL `/users/:`. Section NOT in DOM.
5. **`f2-multiple-path-vars-ordered`** — URL `/users/:userId/posts/:postId`. Two rows, in DOM order userId then postId.
6. **`f2-reserved-char-strips-colon`** — Set URL to `/users/`. Send keystrokes `:` then `/`. Assert URL value is now `/users//` and no row exists.
7. **`f2-trailing-colon-preserved`** — Set URL to `/users/`. Type `:`. URL is `/users/:`. No row. Type `i` then `d`. Now URL is `/users/:id` and row exists.
8. **`f2-removing-name-removes-row`** — Set URL to `/users/:id` (row exists). Use Playwright keyboard to backspace 3 chars. URL `/users/`, row gone.
9. **`f2-key-readonly`** — Path-var key input has `readOnly` attribute. Type into it; value unchanged.
10. **`f2-value-edit-in-list`** — Set URL to `/anything/:id`. In the list, type `42` into value cell. Save. Reload. Open request. Path-var value still `42`.
11. **`f2-persistence-across-reload`** — Create request, set URL `/anything/:id`, value `7`. Save. Reload page. Open request. URL still has `:id`, value still `7`. Send → response URL contains `/anything/7`.
12. **`f2-curl-preview-matches`** — Same request as #11 but inspect cURL panel. Assert preview contains `'https://httpbin.org/anything/7'` (or however the URL is built).
13. **`f2-duplicate-name-single-row`** — URL `/a/:id/b/:id`. One row for `id`. Set value `X`. Send → response URL contains `/a/X/b/X`.
14. **`f2-section-hidden-when-no-path-vars`** — URL `/users`. Section not in DOM.
15. **`f3-overlay-highlight-on-url`** — URL `/users/:id`. Inspect the URL input's overlay; assert a `.env-var-highlight.path-resolved` (or `path-unresolved`) span exists wrapping `:id`.
16. **`f3-overlay-no-highlight-in-headers`** — Add a header value `:id`. Inspect headers value cell. NO `.env-var-highlight.path-*` span.
17. **`f3-popover-opens-on-hover`** — URL `/users/:id`, value `42`. Hover the `:id` in the URL. Assert popover visible with text `id` and value `42`.
18. **`f3-popover-edits-value`** — Hover `:id`. Click popover. Type `99`, press Enter. Path Variables row value is now `99`.
19. **`f3-prefix-not-confused`** — URL `/api/:foo/:foobar`, both with values. Hover `:foo`. Popover shows `foo`. Hover `:foobar`. Popover shows `foobar`.

### Regression — existing specs continue to pass

- `e2e/environment.spec.ts` — env substitution still works.
- `e2e/collection-variables.spec.ts` — collection substitution still works.
- `e2e/request-editor.spec.ts` — params, headers, body, send still work.
- `e2e/curl-preview.spec.ts` (if it exists) — cURL still renders.
- `e2e/workflow.spec.ts` — workflows still execute. (Bonus: AC-F1.7 fixes a subtle pre-existing override bug; existing tests don't catch it but newly written ones should.)

### Implementation order

1. **F1** — migration, data layer, shared util, refactor three call sites. Run all existing E2E to confirm green.
2. **F2** — RequestEditor parsing + Path Variables section + save persistence. Add F2 E2E tests.
3. **F3** — overlay highlight + popover wiring. Add F3 E2E tests.

Each phase ships green before moving on.

## Risks & Notes

- **Caret jumping after sanitization.** When `sanitizeUrlForPathVars` removes a `:`, the input `value` shrinks by 1 char. React re-renders; the browser preserves caret position relative to the start, which lands the caret in the right place (right after the absorbed character). Verified in browser; if Agent B sees flicker, defer caret correction to `requestAnimationFrame` and `setSelectionRange` to the position where the typed char would have landed (cursor was at `oldPos + 1`, sanitization removed 1 char before cursor, so new pos = `oldPos + 1 - 1 = oldPos`).

- **Substitution regex character class for path-var name termination.** The `(?=$|[/?#\[\]@!$&'()*+,;=\s])` lookahead in `substituteUrl` MUST mirror `PATH_VAR_RESERVED` exactly. If they drift, `:foo.bar` (which is valid — no reserved char) might fail to substitute correctly. Single source of truth: `PATH_VAR_RESERVED` Set; build the lookahead from it programmatically OR keep them lockstep with a comment.

- **Path-var name with regex meta chars.** `escapeRegex(pv.key)` in `substituteUrl` handles this (a user couldn't legitimately enter `[` since it's reserved, but defensive escape is cheap).

- **`workflows` table doesn't replicate path_variables.** Workflow steps are request-ID references, so they look up `request.path_variables` from the DB at execution time. No data duplication needed. Confirmed in `useWorkflowExecution.js:138` style.

- **Postman compatibility on import.** Postman's collection v2.1 stores path variables in `request.url.variable[]`. NOT included in this PR — `import-postman` E2E test already passes; we just won't extract path vars yet. Follow-up issue worth filing after this lands.

- **`:` in the host portion of the URL.** Many users type `https://localhost:3000/api/:id`. Our parser currently treats `:3000` as a path-var named `3000` — clearly wrong. Mitigation: the `extractPathVarTokens` parser must skip `:` that appears between `://` and the first `/`. Add this guard:
  ```js
  // Skip the scheme://host:port section
  let pathStart = 0;
  const schemeMatch = url.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//);
  if (schemeMatch) {
    const afterScheme = schemeMatch[0].length;
    const firstSlash = url.indexOf('/', afterScheme);
    pathStart = firstSlash === -1 ? url.length : firstSlash;
  }
  // Then iterate from pathStart instead of 0.
  ```
  Test fixture: URL `https://localhost:3000/api/:id` → `extractPathVarTokens` returns ONE token `id`, NOT `3000`.

  This is critical and must be in F1 from day one. Add an explicit acceptance test:

  **AC-F1.9 — Port number in URL is not treated as path-var**
  - `extractPathVarTokens('https://localhost:3000/api/:id')` returns exactly `[{ key: 'id', start: 27, end: 30 }]`.
  - `substituteUrl('https://localhost:3000/api/:id', { pathVariables: [{key:'id', value:'42'}] })` returns `https://localhost:3000/api/42`.

- **`:` in query string.** A user may have `?token=foo:bar` after the `?`. Following the same logic, `:` in the query-string portion shouldn't be parsed as a path var. Refine the parser to also stop at `?` and `#`:
  ```js
  // After computing pathStart, also compute pathEnd at the first ? or #
  const queryStart = url.indexOf('?', pathStart);
  const hashStart = url.indexOf('#', pathStart);
  let pathEnd = url.length;
  if (queryStart !== -1) pathEnd = Math.min(pathEnd, queryStart);
  if (hashStart !== -1) pathEnd = Math.min(pathEnd, hashStart);
  // Iterate i from pathStart to pathEnd.
  ```

  **AC-F1.10 — `:` in query string ignored**
  - `extractPathVarTokens('/api/:id?ts=2024:01:01')` returns ONE token `id`. The `:01:01` in the query string is ignored.

These two parser refinements (port and query) are non-negotiable for F1.
