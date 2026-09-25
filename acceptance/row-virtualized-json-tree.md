# Row-virtualized JSON tree view (GH-70) - Acceptance Criteria

## Description (client-readable)
The Response viewer renders a JSON body as an expandable tree. Today every node becomes a DOM element, so a 10 MB body freezes the browser. The tree now renders only the rows currently scrolled into view (plus a small overscan) while keeping the same look and interactions: quoted key names, type-colored values, a per-node expand/collapse arrow, an item-count badge on containers, and a per-node copy control. There is one rendering path for every response size.

## Interface Contract
This is the shared agreement between the Test Writer and the Implementer. Both agents receive this full acceptance spec (including this contract) but not each other's code.

### Out of scope (do not touch)
Search features beyond keeping the existing dock working; tab persistence beyond the quota guard below; raw text, HTML, image, PDF, hex bodies; the saved-example response editor; any size threshold or fallback renderer.

### Dependencies (already installed by the parent)
- `@tanstack/react-virtual` ^3.14 (row virtualization). `@uiw/react-json-view` has been removed from `package.json`; nothing may import it.

### Node ids
A node id is `JSON.stringify(path)` where `path` is the array of object keys / array indices from the root. Root id is `'[]'`; `{"a":[{"b":1}]}` has ids `'[]'`, `'["a"]'`, `'["a",0]'`, `'["a",0,"b"]'`. These ids are identical to the strings the existing search dock already builds (`JSON.stringify(m.path.slice(0, i))`).

### Module `src/utils/jsonTree.js` (pure, no React, iterative — must not recurse)
```js
export const ROOT_ID = '[]';
export function childId(parentId, key)          // '["a"]' + 0 -> '["a",0]'; ROOT_ID + 'a' -> '["a"]'
export function ancestorIds(id)                 // '["a",0,"b"]' -> ['[]', '["a"]', '["a",0]'] (excludes id itself)
export function valueType(v)                    // 'string' | 'int' | 'float' | 'boolean' | 'null' | 'undefined' | 'nan' | 'object' | 'array'
                                                // Number.isInteger -> 'int'; other finite/inf numbers -> 'float'; Number.isNaN -> 'nan'; bigint -> 'int'
export function buildJsonTree(value)            // -> { nodes: Node[] }  preorder, root first
export function createExpansion(mode)           // -> { mode: 'expanded' | 'collapsed', overrides: new Set() }
export function isNodeExpanded(node, expansion, forcedIds) // see rule B3
export function toggleNode(expansion, id)       // -> NEW expansion object (same mode, overrides toggled for id); never mutates input
export function flattenVisibleRows(tree, expansion, forcedIds) // -> Row[]
export function nodeToJsonText(node)            // copy text for one node, see rule B6
export function rowIndexMap(rows)               // -> Map<rowId, index>
```
Shapes:
```
Node = {
  id: string, parentId: string | null, depth: number (root 0),
  key: string | number | null,        // object key, array index, or null for root
  keyKind: 'object' | 'array' | 'root',
  type: valueType(value), value: any,
  childCount: number,                 // 0 for primitives and empty containers
  end: number,                        // index in nodes[] just past this node's last descendant
  isLast: boolean                     // true when there is no following sibling (root: true)
}
Row = {
  kind: 'open' | 'leaf' | 'empty' | 'close',
  rowId: string,                      // node.id for open/leaf/empty; node.id + ':close' for close
  node: Node, depth: number,
  expanded: boolean                   // open rows only; false otherwise
}
```
Rules:
- Every container with `childCount > 0` yields one `open` row. If expanded it is followed by its children's rows and one `close` row (depth = node.depth). If collapsed it yields only the `open` row with `expanded: false`.
- A container with `childCount === 0` yields one `empty` row. A primitive yields one `leaf` row.
- Object children are emitted in `Object.keys` order; array children in index order.

### Component `src/components/JsonTreeView.jsx`
```jsx
<JsonTreeView
  value={any}                                  // parsed JSON body
  expansion={{ mode, overrides }}              // from createExpansion / toggleNode
  onToggleNode={(id) => void}                  // arrow click
  forcedIds={Set<string> | null}               // node ids that must render expanded (search ancestors)
  highlightQuery={string}                      // '' or undefined = no highlighting
  activeMatch={{ id, kind: 'key' | 'value', ordinal } | null}
  onCopy={(clipboardEvent) => void}            // attached to the scroll wrapper
/>
```
DOM (selectors are the contract):
- Scroll wrapper: `div.json-view-wrapper[data-testid="json-tree"][data-total-rows="<rows.length>"]` — this element scrolls (`overflow-y: auto`) and receives `onCopy`. Inside it a `div.json-tree-body` whose height equals the virtualizer total size; rows are absolutely positioned inside it in row order.
- Only rows inside the scroll viewport plus an overscan of at most 20 rows above and below are mounted. At no time may more than 150 row elements exist in the DOM for a 400 px tall viewport, regardless of body size.
- Row: `div.json-tree-row[data-testid="json-tree-row"][data-path="<node.id>"][data-depth="<depth>"][data-kind="open|leaf|empty|close"][data-expanded="true|false"]` (`data-expanded` only on `open` rows). Rows are laid out in flat row order (each row is a block; a native text selection yields one row per line). Row indent = `12 + depth * 16` px `padding-left`.
- Arrow (open rows only): `button.json-tree-arrow[data-testid="json-tree-arrow"][aria-expanded="true|false"]` with `aria-label` `"Collapse"` / `"Expand"`; lucide `ChevronDown` (expanded) / `ChevronRight` (collapsed), size 12. Other rows render an inert `span.json-tree-arrow-spacer` of the same width. Arrow/spacer are `user-select: none`.
- Object key: `span.json-tree-key[data-testid="json-tree-key"]` whose text is `JSON.stringify(key)` (quoted), followed by `span.json-tree-colon` with text `: ` (colon + space, selectable).
- Array index: `span.json-tree-index[data-testid="json-tree-index"]` with text `<index>` followed by `span.json-tree-colon` — both `user-select: none` (an array copy must not contain indices).
- Value (`leaf` rows): `span.json-tree-value[data-testid="json-tree-value"][data-type="<type>"]` whose text is the JSON token: strings `JSON.stringify(value)` (quoted, escaped, never truncated, wraps onto multiple lines), numbers `String(value)`, `true`/`false`, `null`, `undefined`, `NaN`.
- Empty container (`empty` rows): `span.json-tree-bracket` with text `{}` or `[]`; no badge.
- Open row: `span.json-tree-bracket` `{` or `[`; when collapsed additionally `span.json-tree-ellipsis` (text `…`, `user-select: none`) and a closing `span.json-tree-bracket` `}` / `]`. Then the badge `span.json-tree-count[data-testid="json-tree-count"]` with text `N items` (`1 item` when N is 1), `user-select: none`. Badge is rendered on both expanded and collapsed open rows.
- Close row: `span.json-tree-bracket` `}` or `]`.
- Comma: `span.json-tree-comma` with text `,` (selectable) appended to every `leaf`, `empty`, `close` row and every collapsed `open` row whose node has `isLast === false`. Never on the root.
- Copy control (`open`, `leaf`, `empty` rows; never `close`): `button.json-tree-copy[data-testid="json-tree-copy"][aria-label="Copy"][data-copied="false"]`, lucide `Copy` size 12; click → `navigator.clipboard.writeText(nodeToJsonText(node))`, then `data-copied="true"` and lucide `Check` for 1500 ms. The button is rendered for every such row (opacity 0 until the row is hovered/focused — it must be clickable via Playwright's `.click()` on a hovered row). Buttons contain no text nodes.
- Search marks: when `highlightQuery` is non-empty, every case-insensitive occurrence in a key's text or a value's text is wrapped in `mark.response-search-highlight[data-search-hit="true"]`; the occurrence whose node id, kind (`'key'` for the key span, `'value'` for the value span) and ordinal (0-based occurrence index within that text) equal `activeMatch` also carries class `response-search-highlight--active`. When `activeMatch` changes the wrapper scrolls so that row is in view (`virtualizer.scrollToIndex(rowIndex, { align: 'center' })`).
- Colors (CSS in `src/styles/response-viewer.css`, replacing the old `.w-rjv-*` rules): key `#0ea5e9`; string `#22c55e`; int and float `#f59e0b`; boolean `#8b5cf6`; null `#ef4444`; undefined `#586e75`; NaN `#859900`; brackets, colon, index, ellipsis, comma, badge, arrow `var(--text-tertiary)`; copied check `var(--accent-success)`; font `var(--font-mono)` 12px; row `line-height: 20px`; row hover background `var(--bg-hover)`; wrapper background `var(--bg-secondary)`, border `1px solid var(--border-primary)`, radius `var(--radius-md)`.

### `src/components/ResponseViewer.jsx` integration
- The JSON branch renders `<JsonTreeView>` instead of `JsonView`. The dock (`response-json-dock`, `response-search-*`, `response-expand-all-btn`, `response-collapse-all-btn`) and every other body type are unchanged.
- State: `expansion` (`createExpansion('expanded')` initially and whenever `displayResponse` changes). Expand all → `createExpansion('expanded')` and clear the sticky search set; Collapse all → `createExpansion('collapsed')` and clear the sticky search set; arrow → `toggleNode`.
- While a search set (`activeExpandSet`: current-query ancestors, else the sticky `persistentForceSet`) is active the tree is treated as `mode: 'expanded'` for base expansion (parity with the previous `collapsed` prop being unset during search), and a new set resets manual overrides. Because the base mode is already expanded, `forcedIds` is not passed by the viewer (it would change nothing); the prop stays part of the tree API for a collapsed base mode.
- `searchMatches` entries gain `id` (`JSON.stringify(path)`) and `ordinal`; `activeMatch` = the entry at the active index (or null). The old DOM-index active-highlight effect is removed.
- `onCopy` handler: `const fixed = normalizeCopiedJson(selection.toString()); if (fixed !== selected) { e.clipboardData.setData('text/plain', fixed); e.preventDefault(); }`.
- `jsonViewKey` remount hack is removed (no library to remount).

### `src/utils/jsonCopyFix.js`
```js
export function normalizeCopiedJson(text)
```
1. Split on `\n`, trim each line, drop blank lines, drop lines that are only a badge (`/^\d+\s+items?$/`), strip a trailing badge from a line (`/\s+\d+\s+items?(?=,?$)/`), collapse the collapsed-container shapes `{…}` / `[…]` to `{}` / `[]` only when anchored to the row shape (line start or `: ` before, optional `,` then end after), so a `…` inside a string value or key is data and stays.
2. Join with `\n`. If `JSON.parse` succeeds return `JSON.stringify(parsed, null, 2)`.
3. Else if the text ends with `,` drop that trailing comma and retry step 2.
4. Else return the cleaned text. Non-string / empty input is returned unchanged. `rebuildCopiedJson` is deleted.

### `src/utils/persistOpenTabs.js`
> Superseded by GH-72 (`acceptance/tab-persistence.md`): tabs and responses are now stored under split keys and UT-011 below was replaced by that spec's UT-001..UT-013.

```js
export function persistOpenTabs(storage, tabs) // -> 'full' | 'stripped' | 'failed'
```
Writes `storage.setItem('openTabs', JSON.stringify(tabs))`. If that throws (any error), drops tabs' `response` property one tab at a time, largest serialized response first (an unserializable response counts as largest), retrying the write after each drop for at most 3 tabs, then falls back to one write with every response dropped; the first write that fits returns `'stripped'`. If every retry throws, swallows it, `console.warn`s once and returns `'failed'`. Never throws and never mutates the caller's tab objects. `WorkbenchContext.jsx` calls `persistOpenTabs(localStorage, persistentTabs)` in place of the bare `localStorage.setItem`.

### Business Rules
- B1 Single path: identical rendering code for a 200-byte and a 10 MB body.
- B2 Bounded DOM: mounted rows = visible rows + overscan only (see selectors); scrolling to the end of a 10 MB body completes within 1 s.
- B3 Expansion: `base = expansion.mode === 'expanded' || (forcedIds && forcedIds.has(id))`; `expanded = overrides.has(id) ? !base : base`. Expand all / Collapse all reset overrides. An arrow click toggles one id only; row expansion state lives in React state, not the DOM, so it survives scrolling away and back.
- B4 Copy: a native cursor selection of visible rows yields text with separating commas and without badges, indices or ellipsis; after `normalizeCopiedJson` a full-tree selection is valid JSON equal to the body.
- B5 Per-node copy copies exactly `nodeToJsonText(node)`.
- B6 `nodeToJsonText`: containers → `JSON.stringify(value, null, 2)`; strings → `JSON.stringify(value)`; numbers/booleans/null → `String(value)`; undefined → `'undefined'`; NaN → `'NaN'`.
- B7 Reset: a new `displayResponse` resets expansion to all-expanded, closes search and clears the sticky set (existing behavior).
- B8 A quota error while persisting tabs must never reach the ErrorBoundary.
- B9 No recursion in tree building/flattening (10 MB bodies can be deep and wide); `buildJsonTree` + `flattenVisibleRows` for a ~10 MB body must finish under 1 s in Node.

## Unit Acceptance Tests (Vitest, `src/**/*.test.js`)
| ID | Scenario | Expectation |
|----|----------|-------------|
| UT-001 | `childId` / `ancestorIds` / `ROOT_ID` | ids equal `JSON.stringify(path)` forms; ancestors listed root-first |
| UT-002 | `valueType` | string/int/float/boolean/null/undefined/nan/object/array classified as specified |
| UT-003 | `buildJsonTree` on `{"a":[{"b":1},2],"c":{}}` | preorder nodes with correct depth/key/keyKind/childCount/end/isLast |
| UT-004 | `flattenVisibleRows` all expanded | open/leaf/empty/close rows in order, close rows carry node depth |
| UT-005 | `flattenVisibleRows` mode collapsed | only the root open row (`expanded:false`) |
| UT-006 | `toggleNode` + override semantics (B3) | toggling once collapses under expanded mode and expands under collapsed mode; input not mutated |
| UT-007 | `forcedIds` with mode collapsed | forced ancestors render expanded, siblings stay collapsed; override on a forced id collapses it |
| UT-008 | `nodeToJsonText` per type (B6) | exact strings |
| UT-009 | Perf budget (B9) | generated ~10 MB body: build + flatten (expanded) < 1000 ms, row count > 100000 |
| UT-010 | `normalizeCopiedJson` | full tree text with commas → pretty JSON; badge/ellipsis lines stripped; trailing comma partial selection → valid; unbalanced fragment returned cleaned; non-string unchanged |
| UT-011 | `persistOpenTabs` | writes full JSON; on throw retries without `response` and returns `'stripped'`; double throw → `'failed'`, no exception |

## Frontend Acceptance Tests (Playwright, `e2e/response-viewer-virtualized-tree.spec.ts`, real app + real browser-direct transport)
Fixture: `e2e/helpers/jsonFixtureServer.ts` exports `startJsonFixtureServer()` → `{ baseUrl, close() }`: a Node `http` server bound to `127.0.0.1` on a free port, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`, `OPTIONS` → 204, routes: `/large.json` (deterministic, serialized size ≥ 10 MiB, an object with a `records` array of objects containing strings, ints, floats, booleans, nulls, nested objects, arrays, an empty object and an empty array), `/types.json` = `{"str":"hello","int":42,"float":3.14,"neg":-7,"yes":true,"no":false,"nothing":null,"emptyObj":{},"emptyArr":[],"long":"<a 2000-character string>","nested":{"a":{"b":{"c":"deep"}}},"list":[1,2,3]}`, `/deep.json` = `{"slideshow":{"author":"Yours Truly","date":"date of publication","slides":[{"title":"Wake up to WonderWidgets!","type":"all"},{"items":["Why WonderWidgets are great","Who buys WonderWidgets"],"title":"Overview","type":"all"}],"title":"Sample Slide Show"}}`, `/plain.txt` (`text/plain`). The app sends to `http://127.0.0.1:<port>/...` which its transport fetches directly from the browser (no proxy needed). Use the existing spec helpers pattern (createTestRequest / sendRequestAndWaitForResponse / cleanupTestCollections). Screenshots go to `test-results/screenshots/json-tree-*.png`.
| ID | User Action | Expected Result |
|----|------------|----------------|
| FE-001 | Send `/types.json` | `json-tree` visible; quoted keys; `json-tree-value[data-type]` for string/int/float/boolean/null with computed colors `rgb(34, 197, 94)`, `rgb(245, 158, 11)`, `rgb(139, 92, 246)`, `rgb(239, 68, 68)`; key color `rgb(14, 165, 233)`; arrows on `nested`/`list`; badge `3 items` on `list`, `1 item` on `nested`; a `json-tree-copy` per non-close row |
| FE-002 | Same response | `emptyObj` row text contains `{}` and `emptyArr` `[]`; `long` value text length ≥ 2002 with no ellipsis |
| FE-003 | Send `/large.json` | `data-total-rows` > 100000; mounted `json-tree-row` count < 150; set wrapper `scrollTop = scrollHeight` → within 1000 ms a row `[data-kind="close"][data-depth="0"]` is mounted; mounted rows still < 150 |
| FE-004 | Collapse all then Expand all on the large body | each completes within 1000 ms (measure in-page from click to attribute change); after collapse `data-total-rows` is `1`; after expand > 100000 |
| FE-005 | Large body in tab A, open request B with `/types.json`, click tab A | tab A tree visible with `data-total-rows` > 100000 within 1000 ms of the click, no error boundary |
| FE-006 | Click arrow of `nested` on `/types.json` | its `data-expanded` → `false`, rows under it unmounted, `list` still expanded; click again restores. On the large body collapse `records[0]`, scroll to bottom and back to top → still collapsed |
| FE-007 | Select the whole wrapper and `document.execCommand('copy')` on `/types.json` | clipboard text `JSON.parse`s and deep-equals the fixture; contains no `items` badge text |
| FE-008 | Hover the `nested` row, click its `json-tree-copy` | clipboard equals `JSON.stringify(nested, null, 2)`; button `data-copied="true"` |
| FE-009 | Send `/plain.txt` | `.response-body` pre shows the text; no `json-tree` |
| FE-010 | Send `/deep.json`; Collapse all; Expand all; re-send | deep text `WonderWidgets` hidden after collapse, visible after expand; after re-send visible again (reset) |
| FE-011 | Collapse all, open search, type `WonderWidgets` | a `mark.response-search-highlight[data-search-hit="true"]` is visible (forced expansion + scroll) |

## Test Status
- [x] UT-001..011: PASS — `npm run test:unit` 11 files / 223 tests (2026-09-24)
- [x] FE-001..011: PASS — `npx playwright test e2e/response-viewer-virtualized-tree.spec.ts` 11/11 on real local Supabase + Vite + fixture server (2026-09-24); screenshots `test-results/screenshots/json-tree-FE-*.png`
