# Response search on the virtualized JSON tree (GH-71) - Acceptance Criteria

## Description (client-readable)
Searching inside a JSON response keeps working exactly as before on the new row-virtualized tree, and it stays responsive on very large bodies: on a 10 MB response each keystroke updates the match counter and brings the first match into view within a second, without freezing the page. Matches inside collapsed or off-screen parts of the tree are found, their ancestors are expanded, and the active match is scrolled into view even though only the visible rows exist in the page.

## Background (measured on the 10 MB `large.json` fixture, base commit 8df2ac0)
- `ResponseViewer.jsx` `findJsonMatches` re-walks the whole parsed JSON on every keystroke (allocating a path array per object key): ~300-460 ms for a query with few or no matches — the UI freeze.
- `JsonTreeView.jsx` builds `rowIndexMap(rows)` (a `Map` over ~474k rows) whenever rows change and an active match exists: ~177 ms.
- A prototype that scans one pre-lowercased string index over `tree.nodes` answers the same queries in < 5 ms (index build ~130 ms, once per body); a linear scan of `rows` for one row id takes ~5 ms.

## Interface Contract
Shared agreement between the Test Writer (Agent A) and the Implementer (Agent B). Both receive this full spec, not each other's code.

### Out of scope (do not touch)
Search in raw text / HTML raw / hex views; regex, case-sensitive or whole-word options; find-and-replace; any new UI surface, button, label or style; tab persistence; copy behavior.

### Existing selectors (unchanged — no new `data-testid` is introduced)
| Selector | Element |
|---|---|
| `[data-testid="response-json-dock"]` | dock above the tree (only for JSON, non-example bodies) |
| `[data-testid="response-search-btn"]` | magnifier (dock at rest) |
| `[data-testid="response-expand-all-btn"]` / `[data-testid="response-collapse-all-btn"]` | dock at rest |
| `[data-testid="response-search-input"]` | search input (bar open) |
| `[data-testid="response-search-count"]` | counter text |
| `[data-testid="response-search-prev"]` / `[data-testid="response-search-next"]` / `[data-testid="response-search-close"]` | bar buttons |
| `[data-testid="json-tree"]` (class `json-view-wrapper`, attribute `data-total-rows`) | the virtualized scroll container |
| `[data-testid="json-tree-row"]` with `data-path` (node id), `data-kind` (`open`/`leaf`/`empty`/`close`), `data-expanded` (`true`/`false` on `open` rows) | one mounted row |
| `[data-testid="json-tree-key"]`, `[data-testid="json-tree-value"]`, `[data-testid="json-tree-arrow"]` | row parts |
| `mark.response-search-highlight[data-search-hit="true"]` | one highlighted hit inside a mounted row |
| `mark.response-search-highlight--active` | the active hit (at most one in the DOM) |

### Node ids
Unchanged from GH-70: `JSON.stringify(path)` of object keys / array indices from the root; root is `'[]'`.

### New module `src/utils/jsonSearch.js` (pure, no React, must not recurse)
```js
export const SEARCH_MATCH_CAP = 5000;
export function normalizeSearchQuery(raw)            // -> string
export function nodeSearchText(node)                 // -> string | null
export function findTreeMatches(tree, query, cap = SEARCH_MATCH_CAP)
  // tree: result of buildJsonTree(value); query: already-normalized string
  // -> Array<{ id: string, kind: 'key' | 'value', ordinal: number }>
```

### Changes to `src/utils/jsonTree.js`
```js
export function findRowIndex(rows, id)   // -> index of the first row whose rowId === id, or -1
export function revealNode(expansion, id) // -> expansion in which every ancestor of id is expanded
// rowIndexMap(rows) is REMOVED (no remaining callers).
```
All other GH-70 exports are unchanged.

### `JsonTreeView` props (`src/components/JsonTreeView.jsx`)
`<JsonTreeView tree expansion onToggleNode forcedIds highlightQuery activeMatch onCopy />`
- `tree` (NEW, replaces `value`): the object returned by `buildJsonTree(value)`; the component no longer builds the tree itself.
- `activeMatch`: `{ id, kind, ordinal } | null` (unchanged shape).
- Everything else unchanged.

### Business Rules
1. **B1 Query normalization** — `normalizeSearchQuery(raw)`: falsy -> `''`; strip at most one leading `"` and then, if the remainder is non-empty, at most one trailing `"`; inner quotes kept. `'"route_id"'` -> `'route_id'`, `'"a'` -> `'a'`, `'a"'` -> `'a'`, `'"'` -> `''`, `'""'` -> `''`, `'a"b'` -> `'a"b'`.
2. **B2 Searchable text** — `nodeSearchText(node)`: `string` -> the raw value (no quotes, no escaping); `int`/`float` -> `String(value)`; `boolean` -> `'true'`/`'false'`; `null` -> `'null'`; `nan` -> `'NaN'`; `undefined` -> `'undefined'`; `object`/`array` (including empty `{}`/`[]`) -> `null`. A node's key text is `String(node.key)` only when `node.keyKind === 'object'`; array indices and the root have no key text. `JsonTreeView` renders leaf values with this same function, so displayed text and searched text never diverge.
3. **B3 Match semantics** (identical to today's `findJsonMatches`) — case-insensitive substring search (`toLowerCase()` on both sides). Nodes are visited in `tree.nodes` (document preorder) order; for each node its key text is searched before its value text. Within one text, occurrences are found left to right and are non-overlapping (the next search starts at `index + query.length` in the lowercased text); `ordinal` is the 0-based occurrence index within that one text. A match lies entirely inside one key or value text — it never spans two texts. Empty query -> `[]`. The result stops at `cap` entries (exactly `cap` when at least that many exist). `id` is the node's `id`.
4. **B4 Index reuse** — the lowercased search data for a tree is built at most once per tree object and reused by later calls with the same tree (e.g. a `WeakMap` keyed by `tree`); a different tree gets its own. It must stay correct when `toLowerCase()` changes a text's length (e.g. `'İ'`).
5. **B5 Performance** — on a ~10 MB body (the GH-70 `large.json` record shape): the first `findTreeMatches` call for a tree (index build included) < 1000 ms; each later call on the same tree < 100 ms, both for a no-match query and for a query that hits the cap. `findRowIndex` over the fully expanded rows < 50 ms.
6. **B6 Row lookup** — `findRowIndex(rows, id)` returns the index of the `open`/`leaf`/`empty` row for node `id` (close rows have rowId `${id}:close` and never match), `-1` when the node is not currently visible (inside a collapsed container) or unknown.
7. **B7 Reveal** — `revealNode(expansion, id)`: for every id in `ancestorIds(id)` the result has `mode === 'expanded' ? !overrides.has(a) : overrides.has(a)` true. The node `id` itself is not changed. Returns the SAME object when nothing needed to change; otherwise a NEW object with the same `mode` and a new `overrides` Set; never mutates the input.
8. **B8 Discovery gating** — matches are computed only while the search bar is open, the effective (normalized) query is non-empty, the body is JSON and the view is not a saved example; otherwise there are none. The tree is built once per JSON body in `ResponseViewer` and passed to `JsonTreeView`.
9. **B9 Auto-expand** — whenever the match list changes to a new non-empty list (new query, reopened bar), the expansion state becomes plain all-expanded (`mode 'expanded'`, no overrides — parity with the old library remount, which expanded every node and dropped manual toggles). This is applied before the tree renders with the new matches (no intermediate tree render with the stale expansion; e.g. React's derive-state-during-render pattern). A query with zero matches leaves the expansion unchanged.
10. **B10 Active match** — the active match is `matches[clamp(activeIndex)]`; typing resets the index to 0 (first match). Whenever the active match changes, the expansion the tree renders has every ancestor of the active match expanded (`revealNode`) — so a node the user collapsed mid-search is re-opened when navigation lands inside it. The tree scrolls the active match's row into view (centered) even when that row was not mounted, and re-scrolls when rows above it change its index; it does not re-scroll on unrelated re-renders. Only mounted rows render `<mark>`s; exactly the active hit carries `response-search-highlight--active`.
11. **B11 Navigation + counter** — Enter / Next button: `(i + 1) % n`; Shift+Enter / Prev button: `(i - 1 + n) % n`; both disabled/no-op when `n === 0`. Counter: `''` when the effective query is empty; `'0 / 0'` when non-empty with no match; otherwise `` `${i + 1} / ${n}` `` plus `'+'` when `n >= SEARCH_MATCH_CAP`.
12. **B12 Keyboard** — Ctrl+F / Cmd+F while focus is inside the response viewer and the body is a JSON non-example: `preventDefault()` (the browser's native find must not open) and open the bar (or refocus + select the input if already open). Outside the viewer the hotkey is not handled. Escape (input or viewer) closes the bar and clears the query and active index.
13. **B13 Sticky expansion** — closing the bar does not change the expansion (the tree keeps what the search reached, including manual toggles). Expand all -> `createExpansion('expanded')`; Collapse all -> `createExpansion('collapsed')`. A new response resets expansion to all-expanded and closes the bar (as today). The old `forceExpandSet` / `persistentForceSet` / `treeExpansion` machinery is removed; the expansion state alone drives the tree.
14. **B14 Availability** — non-JSON bodies (plain text, HTML, image, PDF) and saved examples show no dock and no search; if the body stops being a JSON non-example view the bar closes (as today).

## Unit Acceptance Tests (Vitest, `npm run test:unit`)
| ID | Scenario | Expected |
|----|----------|----------|
| UT-101 | `normalizeSearchQuery` cases of B1 incl. `null`/`undefined`/`''` | exact outputs of B1 |
| UT-102 | `nodeSearchText` for every node type of B2 (string with quotes/backslash/newline, int, float, negative, true, false, null, NaN, undefined, `{}`, `[]`, non-empty object/array) | B2 outputs; containers -> `null` |
| UT-103 | order/kind/ordinal: `{ ab: 'xabyab', list: ['ab', 1], nested: { abab: true } }`, query `'ab'` | `[["ab"] key 0, ["ab"] value 0, ["ab"] value 1, ["list",0] value 0, ["nested","abab"] key 0, ["nested","abab"] key 1]` in that order; `'aaa'` with query `'aa'` -> one match |
| UT-104 | case-insensitive; number substring (`12345` with `'34'`), boolean (`'tru'`), null (`'nul'`); array indices, root and containers never match (`['x']` with `'0'` -> `[]`) | as described |
| UT-105 | cap: more than cap occurrences -> exactly `cap` entries (default 5000 and a custom small cap); empty query -> `[]` | as described |
| UT-106 | no cross-text matches (`{ a: 'ab', b: 'cd' }` with `'bc'` -> `[]`; with `'\u0000'` and `'\n'` -> `[]`); a value that itself contains `'\u0000'` / `'\n'` still matches that character; key `'İx'` with query `'x'` yields that key match with the right id plus later matches with the right ids (B4) | as described |
| UT-107 | ids equal `tree.nodes` ids (`JSON.stringify(path)`), including keys needing escaping (`'we"ird'`) | as described |
| UT-108 | index reuse (B4): results for tree A unaffected by searching tree B; repeated calls on the same tree return equal results | as described |
| UT-109 | perf (B5) on a ~10 MB `records` body: first call < 1000 ms, later no-match call < 100 ms, later cap-hitting call < 100 ms; `findRowIndex` for the last record's row over fully expanded rows < 50 ms | as described |
| UT-110 | `findRowIndex`: open/leaf/empty rows found; close rowId never matched; node under a collapsed container -> `-1`; unknown id -> `-1` | as described |
| UT-111 | `revealNode` in `expanded` mode (removes collapsing overrides of ancestors only) and `collapsed` mode (adds ancestor overrides); leaves the node itself and unrelated overrides untouched; identity preserved when nothing changes; input never mutated | as described |
| (update) | existing `src/utils/jsonTree.test.js` references to `rowIndexMap` move to `findRowIndex` | suite green |

## Frontend Acceptance Tests (Playwright, real backend + local fixture server)
New spec `e2e/response-viewer-search-virtualized.spec.ts` (fixture server `e2e/helpers/jsonFixtureServer.ts`, bodies fetched straight from the browser at `http://127.0.0.1:<port>`; the app, auth and collections run on the real local Supabase; no `page.route()`).

| ID | User Action | Expected Result |
|----|------------|----------------|
| FE-101 | `types.json`: click a tree row, press Ctrl+F | bar opens, input focused, the keydown was `defaultPrevented` (observed by a window listener); Escape closes; reopen via magnifier -> input empty, no marks |
| FE-102 | `large.json` (>= 10 MiB): type a query character by character that ends up matching one leaf in the last record | after every keystroke the counter reflects the new query within 1000 ms; after the last keystroke the active mark is inside the tree's visible viewport and the counter reads `1 / 1`; no main-thread long task > 1000 ms during typing, and none > 300 ms on keystrokes after the first |
| FE-103 | `large.json`: Collapse all (1 row), then search a value of the last record | within 1000 ms the counter reads `1 / 1`, the record's ancestor rows (`["records"]`, `["records",N]`) are `data-expanded="true"`, active mark visible in the viewport |
| FE-104 | `large.json` at scrollTop 0: before searching, the last record's row is not mounted; search a term unique to it | its row mounts, the active mark is within the viewport |
| FE-105 | `large.json`: a query matching > 5000 times | counter `1 / 5000+`; Next twice -> `3 / 5000+`; Shift+Enter from `1` wraps to `5000 / 5000+` with the active mark visible |
| FE-106 | `deep.json`: query `"author"` (with quotes) | counter `1 / 1`, the mark is inside a `json-tree-key` |
| FE-107 | `deep.json`: Collapse all, search `WonderWidgets`, close | rows stay expanded after closing (deep text visible, no marks); Collapse all -> `data-total-rows="1"`; Expand all afterwards expands everything |
| FE-108 | `deep.json`: search `WonderWidgets` (3 matches), collapse `["slideshow","slides",1]` with its arrow, press Next until the counter reads `2 / 3` | that container is re-expanded and the active mark (inside `["slideshow","slides",1,"items",0]`) is visible |
| FE-109 | `plain.txt`: click the body, press Ctrl+F | no dock and no search input |
| FE-110 | `e2e/response-viewer-search.spec.ts` (existing flows) ported from httpbin.org to the local fixture server (`deep.json` for `httpbin.org/json`; add an HTML route for the HTML test and a JSON route for the number test; `types.json` makes the former `test.fixme` boolean test runnable) | every test passes; assertions keep their original intent |

Screenshots at key steps when `PAPERPLANE_CAPTURE_SCREENSHOTS=1` (pattern of `e2e/response-viewer-virtualized-tree.spec.ts`: `test-results/screenshots/...png`).

## Test Status
- [x] UT-101..UT-111: PASS (Vitest 234/234, 2026-09-25)
- [x] FE-101..FE-109: PASS (`e2e/response-viewer-search-virtualized.spec.ts`, real local Supabase + local fixture server)
- [x] FE-110: PASS (`e2e/response-viewer-search.spec.ts`, 23 tests ported off httpbin.org, including the former `test.fixme` boolean test)
- Discrimination: FE-102, FE-103 and FE-108 fail against the base implementation (8df2ac0)
