# Tab persistence without re-serializing responses (GH-72) - Acceptance Criteria

## Description (client-readable)
Open tabs keep surviving a reload together with their last responses, but editing one tab no longer rewrites every other tab's response body to browser storage. With several tabs holding 10 MB responses, typing in another tab's URL stays as responsive as it is with no responses open. When a response is too large for browser storage, the app keeps working: the response is simply not persisted, and no error screen appears.

## Background (base commit 6afbe93)
- `src/contexts/WorkbenchContext.jsx:190-197` runs an effect on every `openTabs` change (every keystroke, detail-tab switch, dirty flag change, response arrival) and calls `persistOpenTabs(localStorage, tabs)`.
- `src/utils/persistOpenTabs.js` writes `JSON.stringify(tabs)` - every persisted tab including its full `response` - under the `openTabs` key. On a quota error it re-stringifies every response to rank sizes and retries up to four more full writes. With three 10 MB bodies that is 30-100+ MB of serialization per keystroke.
- `src/stores/workbenchStore.js:11` restores with a bare `JSON.parse(localStorage.getItem('openTabs') || '[]')`, which throws on corrupt data.

## Interface Contract
Shared agreement between the Test Writer (Agent A) and the Implementer (Agent B). Both receive this full spec, not each other's code.

### Out of scope (do not touch)
Response viewer rendering and search; which tab kinds are persisted; server, proxy or Supabase code; the `activeTabId` localStorage entry; any UI, CSS or new `data-testid`.

### Storage layout
| Key | Value |
|---|---|
| `openTabs` | JSON array of the persisted tabs **without** their `response` property |
| `openTabs:response:<tabId>` | JSON of that tab's `response` object (one key per tab that has a response) |

### Module `src/utils/persistOpenTabs.js` (pure JS, no React)
```js
export const OPEN_TABS_KEY = 'openTabs';
export const RESPONSE_KEY_PREFIX = 'openTabs:response:';
export function responseKey(tabId)            // -> RESPONSE_KEY_PREFIX + tabId
export function persistOpenTabs(storage, tabs) // -> 'full' | 'stripped' | 'failed'; never throws
export function loadOpenTabs(storage)          // -> Array<tab>; never throws
```
`storage` is any object with `getItem`, `setItem`, `removeItem` (a `Storage`, or a test fake). `length` and `key(i)` are used only when present (orphan cleanup in `loadOpenTabs`).

#### `persistOpenTabs(storage, tabs)`
`tabs` is the raw `openTabs` array from the store. A non-array is treated as `[]`. Input tab objects are never mutated.

1. **Selection** - persisted tabs are `tabs.filter((t) => !t.isTemporary)`, each shallow-copied with `runState`, `docsCache` and `response` removed. (This filtering moves here from `WorkbenchContext`.)
2. **Metadata write** - exactly one `storage.setItem('openTabs', JSON.stringify(persistedTabsWithoutResponse))`.
3. **Response writes** - the module keeps, per `storage` object (e.g. a `WeakMap` keyed by storage), a record `tabId -> response object last handled`. For each persisted tab, in order:
   - `response` is non-null and `===` the recorded object for that tab id -> **no storage call and no `JSON.stringify` of that response**.
   - `response` is non-null and differs (or nothing recorded) -> `storage.setItem(responseKey(id), JSON.stringify(response))`. If stringifying or `setItem` throws: `storage.removeItem(responseKey(id))` (its own errors swallowed) and this call's result becomes `'stripped'`. In both outcomes the response is recorded as handled, so an unchanged response that failed is **not retried** on later calls.
   - `response` is `null`/`undefined` and a response was recorded for the id -> `storage.removeItem(responseKey(id))`, forget the id.
4. **Closed tabs** - every recorded tab id not among the persisted tabs (closed, or now temporary) -> `storage.removeItem(responseKey(id))`, forget the id.
5. **Metadata write failure** - when step 2 throws: `removeItem(responseKey(id))` for every recorded id and every persisted tab id, record each persisted tab's current `response` as handled (so step 3 does not re-write them), then retry the metadata write once. Retry succeeds -> continue with steps 3-4 and return `'stripped'`. Retry fails -> return `'failed'`; `console.warn` fires only on the first failing call of a failure streak (per storage), and a later successful metadata write re-arms it, so a persistent failure does not warn on every keystroke.
6. **Result** - `'full'` when the metadata write succeeded on the first try and no response write failed during this call; `'stripped'` when any response was dropped during this call; `'failed'` when the metadata could not be written. Nothing ever throws out of the function (unserializable/circular responses included).

Consequence: the work done per call is proportional to the metadata (tab list and request objects) plus the responses that actually changed - never to unchanged responses in other tabs.

#### `loadOpenTabs(storage)`
1. `getItem('openTabs')`; `null`, unparseable JSON or a non-array -> return `[]`. Entries that are not plain objects are dropped.
2. For each tab: if the stored tab object has its own `response` property (legacy format written before GH-72) keep it as is and do **not** record it (the next `persistOpenTabs` moves it to its own key and strips it from `openTabs`). Otherwise read `getItem(responseKey(tab.id))`; when present and parseable set `tab.response` to the parsed object and record that exact object as handled for this storage (so the first persist after startup does not rewrite it). When unparseable, `removeItem` the key and leave the tab without a response.
3. When `storage.length`/`storage.key` exist, remove every key starting with `RESPONSE_KEY_PREFIX` whose tab id is not among the loaded tabs (collect first, then remove).
4. Any storage error is swallowed; return whatever tabs could be loaded.

Round trip: `persistOpenTabs(s, tabs)` then `loadOpenTabs(s)` deep-equals the persisted selection of `tabs` (non-temporary, without `runState`/`docsCache`), each with its `response` when that response was stored.

### Callers
- `src/contexts/WorkbenchContext.jsx`: the persistence effect becomes `persistOpenTabs(localStorage, openTabs)` (no local filtering).
- `src/stores/workbenchStore.js`: initial state `openTabs: loadOpenTabs(localStorage)`.

### Selectors used by E2E (existing, unchanged)
| Selector | Element |
|---|---|
| `.url-input` | request URL input of the active request tab |
| `.btn-send` | send button |
| `.response-viewer`, `.response-meta`, `.response-viewer.loading` | response panel, status line, loading state |
| `[data-testid="json-tree"]` (`data-total-rows`) | JSON tree of a response body |
| `.collection-header` + `.btn-menu` + `.collection-menu .request-menu-item` "Add Request" | create a request (opens in a new tab) |
| `.tab-bar`/tab items as used by `e2e/tab-context-menu.spec.ts` | open tabs |
| `[data-testid="error-boundary-fallback"]` | root error boundary screen |

## Known limitations (out of scope, follow-up candidates)
- Example tabs keep the saved response inside `tab.example.response_data`, and file uploads ride as base64 in `tab.request.form_data`; both stay in the `openTabs` metadata and are serialized on every change (changing which tab data is split out is outside GH-72).
- Several app windows share localStorage: response keys are per tab id, so closing a tab in one window drops its persisted response for the others, and a load in a new window removes keys it sees as orphans.
- Reverting GH-72 leaves `openTabs:response:*` keys that the old code never removes.

## Acceptance Criteria
- **AC-1** With three request tabs each holding a >= 10 MiB JSON response, typing in the URL field of a fourth request tab has a per-keystroke latency within 50 ms of the latency measured in the same session before any response was loaded.
- **AC-2** Editing one tab does not re-serialize other tabs' responses: while typing, no `openTabs:response:*` key is written and no storage write carries a response body (every `openTabs` write stays small).
- **AC-3** Open tabs and their last responses restore after a reload.
- **AC-4** When a response does not fit the storage quota, the app shows no error boundary, the tabs stay usable (typing, switching, sending), and the other tabs and responses still persist.
- **AC-5** Temporary tabs, `runState` and `docsCache` are never persisted.
- **AC-6** Corrupt or legacy (inline-response) stored data loads without throwing; legacy data migrates to the split layout on the next write; orphaned response keys are removed on load.

## Test Cases

### E2E (`e2e/tab-persistence.spec.ts`, real app + real local Supabase, local fixture server `e2e/helpers/jsonFixtureServer.ts`; no `page.route()`)
- **FE-001 (AC-1, AC-2, regression)** Baseline: in a request tab with no responses loaded anywhere, measure the median per-keystroke time for typing a fixed string (e.g. 10 characters) into `.url-input`. Then in three request tabs send `<fixture>/large.json`; open a fourth request tab; install an in-page recorder that wraps `Storage.prototype.setItem` (records key + value length, then delegates to the original - instrumentation only); type the same length string into its `.url-input` and measure. Assert median(large) - median(baseline) <= 50 ms, no recorded key starts with `openTabs:response:`, and every recorded `openTabs` value is < 1 MiB. Must FAIL on the unfixed code.
- **FE-002 (AC-3)** Two request tabs send small fixtures (`/types.json`, `/deep.json`); reload; both tabs are present and each shows its restored response (status line + a known key in the JSON tree) without re-sending.
- **FE-003 (AC-4)** One tab sends `/large.json` (over quota), another sends `/types.json`. The large tab's `openTabs:response:<id>` key is absent while `openTabs` still lists that tab (proves the over-quota path ran). No error boundary; typing into the URL and switching tabs work; sending another request works. Reload: both tabs are present and the small response is restored.

### Unit (`src/utils/persistOpenTabs.test.js`, Vitest + fake storage)
- **UT-001** Metadata goes to `openTabs` without any `response`; each response goes to `openTabs:response:<id>`; result `'full'`.
- **UT-002 (regression)** Second call with a changed request on one tab and identical response objects: exactly one `setItem` (the `openTabs` key), no response-key writes, and unchanged responses are not stringified again (e.g. a `toJSON` call counter on each response stays at 1 after the second call), and the `openTabs` value contains no response body.
- **UT-003** A new response object on one tab rewrites only that tab's key.
- **UT-004** Response set to null / tab closed / tab becomes temporary -> its key removed.
- **UT-005** Response write throws -> key removed, `'stripped'`, not retried on the next call with the same object; retried when the object changes.
- **UT-006** Metadata write throws once -> all response keys removed, metadata retried, `'stripped'`; later calls with the same responses do not re-write them.
- **UT-007** Metadata write always throws -> `'failed'`, one `console.warn`, no throw; consecutive failing calls warn once in total; after a successful call, a new failure warns again.
- **UT-008** Circular/unserializable response -> no throw, `'stripped'`, metadata intact.
- **UT-009** Exclusions: temporary tabs, `runState`, `docsCache` never written; input tabs not mutated.
- **UT-010** `loadOpenTabs` round trip restores responses; first persist after load writes no response keys.
- **UT-011** `loadOpenTabs` on missing / corrupt / non-array data -> `[]`; corrupt response entry -> tab without response and key removed.
- **UT-012** Legacy inline-response data loads as is; the next persist writes the response key and strips it from `openTabs`.
- **UT-013** Orphaned `openTabs:response:*` keys are removed on load; unrelated keys untouched.
