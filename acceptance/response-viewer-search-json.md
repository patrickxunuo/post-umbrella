# Acceptance Spec: Response Viewer — Float Dock (search + expand/collapse + default expand-all)

## Problem
`ResponseViewer.jsx` renders JSON through `<JsonView ... collapsed={2}>` (current code after Feature 1). Two real pain points:
1. Browser Ctrl+F only matches what's rendered. Matches inside collapsed nodes are invisible. On large responses the user has to manually click every `{}` / `[]` open before the native search sees anything.
2. Feature 1 parked expand-all / collapse-all icons in the response toolbar next to Download. The developer has asked for a floating control dock pinned inside the JSON viewer itself, and a default expand-all view.

Solution — a floating dock inside the JSON viewer with three controls: **Search**, **Expand-all**, **Collapse-all**. The dock sits in the top-right corner, stays pinned while the user scrolls the JSON body underneath, and transitions into an inline search bar when the user opens search. The default JSON render becomes fully expanded (not `collapsed={2}`). Search walks the parsed JSON and auto-expands the path to every match.

## Scope
**This spec supersedes Feature 1's toolbar buttons.** Agent B MUST remove the toolbar-mounted `response-expand-all-btn` / `response-collapse-all-btn` buttons added by Feature 1 and move the same functionality into the new dock. Test-ids stay identical so Feature 1's E2E spec keeps working (aside from a couple of tests that checked "default is `collapsed={2}`" — those get updated in this feature's E2E spec).

Edit only:
- `src/components/ResponseViewer.jsx` — dock, search state, hotkey capture, JsonView rendering + custom string/key renderers.
- `src/styles/response-viewer.css` — dock + search bar + highlight styles.

No new files. No new dependencies.

Out of scope:
- Raw-text `<pre>` search (Feature 3 — deferred; may be revisited after this ships).
- HTML preview / image preview / PDF preview / binary raw / hex views.
- Example-editing mode (`isExample`) — uses `JsonEditor`.
- Regex / whole-word / replace.

## Interface Contract

### Default collapse mode → `all-expanded`
Change Feature 1's `useState('default')` to `useState('all-expanded')`. Also change the reset effect on new response so `collapseMode` resets to `'all-expanded'`, not `'default'`.

Consequence: the JsonView's `collapsed` ternary simplifies to:
```js
collapsed={collapseMode === 'all-collapsed' ? true : false}
```
The `'default'` / `collapsed={2}` branch is removed entirely. (Agent B: delete the ternary's middle branch.)

The `Expand-all` button is still useful as a reset after the user has manually collapsed some branches, so it stays in the UI even though the default is already fully expanded.

### Toolbar cleanup
Remove from `.response-meta` the expand/collapse buttons Feature 1 added (the two `response-toolbar-btn` elements at roughly lines 360–381 of the current `ResponseViewer.jsx`). The Download button stays exactly where it is. Keep the shared `.response-toolbar-btn, .response-download-btn` CSS selector lists in `response-viewer.css` — `.response-toolbar-btn` is no longer used but leaving the selector alone costs nothing and matches how the stylesheet already reads.

### New dock state in `ResponseViewer`
```js
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState('');
const [searchActiveIndex, setSearchActiveIndex] = useState(0);
const searchInputRef = useRef(null);
const rootRef = useRef(null);
```

Existing Feature 1 state stays: `collapseMode`, `jsonViewKey`, plus the `useEffect` that resets them on `displayResponse` change.

### Match model
A match is `{ path: (string|number)[], kind: 'key' | 'value', text: string, start: number, length: number }`:
- `path` — JSON path from root to the node containing the match (e.g. `['users', 0, 'email']`)
- `kind` — `'key'` if the match is in a property name; `'value'` if in a stringified leaf
- `text` — full text of the containing field so the highlighter can split it
- `start`, `length` — character offsets within `text` for this occurrence

### Match discovery (pure helper `findJsonMatches(json, query)`)
Co-locate at the top of `ResponseViewer.jsx`. DFS walk:
- Empty `query` → return `[]`.
- Case-insensitive substring match. Both sides lowercased before comparison.
- **Keys**: for every key along the walk, stringify the key (`String(key)`) and search it. If the substring matches, emit `kind:'key'` entry.
- **Leaf values**: stringify the value and search. Stringification rules:
  - `string` → the string itself
  - `number`, `bigint` → `String(v)`
  - `boolean` → `'true'` / `'false'`
  - `null` → `'null'`
  - `undefined` → `'undefined'`
  - Any other leaf (`Date`, `NaN`, etc.) → `String(v)`
- **Multiple occurrences in the same string** → emit one entry per occurrence with ascending `start`. This is required so next/prev navigation walks through every visible `<mark>`, not just the first per field.
- Traversal: DFS pre-order; objects keyed by `Object.keys(obj)` order (insertion order for modern engines — what the user sees); arrays in index order.
- Do NOT recurse into primitive values.
- Hard cap **5000 matches** to protect against pathological queries like a single letter in a huge payload. If the cap hits, the counter shows `N / 5000+`.

This gives the semantics the developer asked for:
- Searching `"12"` against `{ code: 123 }` matches (`"123"` contains `"12"`).
- Searching `"tru"` matches boolean `true` (stringified as `"true"`) and string value `"true"`.
- Searching `"ull"` matches `null`.
- Searching `"ema"` matches the key `email`.
- Case-insensitive: `"WONDER"` and `"wonder"` produce the same match set.

### Force-expand set
```js
const forceExpandSet = useMemo(() => {
  if (!searchOpen || !searchQuery || searchMatches.length === 0) return null;
  const s = new Set();
  for (const m of searchMatches) {
    for (let i = 0; i <= m.path.length; i++) {
      s.add(JSON.stringify(m.path.slice(0, i)));
    }
  }
  return s;
}, [searchOpen, searchQuery, searchMatches]);
```

Return `null` when search isn't active so the JsonView falls back to `collapsed` semantics.

### JsonView wiring

When `forceExpandSet` is non-null:
- OMIT `collapsed` prop entirely (library: `collapsed` takes precedence over `shouldExpandNodeInitially`).
- Pass `shouldExpandNodeInitially={(isExpanded, { keys }) => forceExpandSet.has(JSON.stringify(keys)) || isExpanded}`.
- Pass `shortenTextAfterLength={0}` so matched-but-long strings aren't cut mid-match.

When `forceExpandSet` is null:
- Pass `collapsed={collapseMode === 'all-collapsed' ? true : false}` (Feature 1 simplified).
- Do not pass `shouldExpandNodeInitially`.
- Do not pass `shortenTextAfterLength`.

### Re-mount on policy change
Bump `jsonViewKey` whenever:
- A new response arrives (already done in Feature 1's reset effect).
- `searchOpen` toggles.
- `searchQuery` changes in a way that produces a new `forceExpandSet`.

Implementation: one `useEffect` keyed on `[searchOpen, searchQuery]` that calls `setJsonViewKey(k => k + 1)`. (Agent B: skip the bump on initial mount with a ref-guard if it causes a flicker.)

### Highlight renderers (inside `<JsonView>`)
Keep the existing three null-family renderers (they fix a library bug — must not regress). ADD two more:

```jsx
<JsonView.String
  render={(props, { value }) => {
    if (!searchQuery || typeof value !== 'string') return null; // fall through to default
    return renderHighlightedText({ baseProps: props, text: value, query: searchQuery, kind: 'value' });
  }}
/>
<JsonView.KeyName
  render={(props, { value }) => {
    if (!searchQuery) return null;
    const s = typeof value === 'string' ? value : String(value ?? '');
    return renderHighlightedText({ baseProps: props, text: s, query: searchQuery, kind: 'key' });
  }}
/>
```

Also highlight stringified primitives (boolean, number, null) so `"tru"` visibly highlights inside `true`:

```jsx
<JsonView.True  render={(props, { value }) => renderBooleanHit(props, value, true,  searchQuery)} />
<JsonView.False render={(props, { value }) => renderBooleanHit(props, value, false, searchQuery)} />
<JsonView.Int   render={(props, { value }) => renderPrimitiveHit(props, value, searchQuery)} />
<JsonView.Float render={(props, { value }) => renderPrimitiveHit(props, value, searchQuery)} />
```

Where `renderBooleanHit`/`renderPrimitiveHit` stringify the value and delegate to `renderHighlightedText`, returning `null` (fall-through to default) when no match. For `Null`/`Undefined`/`Nan` the existing workaround already renders a `<span>{text}</span>` — extend those to also apply highlights when the text contains the query.

Return-null fallthrough is the same pattern the existing `JsonView.Null` override uses (`type === 'value' ? <span>null</span> : null`). Confirmed-working in this codebase.

### `renderHighlightedText` helper
```js
function renderHighlightedText({ baseProps, text, query, kind }) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q || !lower.includes(q)) return null; // fall through to default

  const parts = [];
  let cursor = 0;
  let idx;
  while ((idx = lower.indexOf(q, cursor)) !== -1) {
    if (idx > cursor) parts.push({ t: text.slice(cursor, idx), hit: false });
    parts.push({ t: text.slice(idx, idx + query.length), hit: true });
    cursor = idx + query.length;
  }
  if (cursor < text.length) parts.push({ t: text.slice(cursor), hit: false });

  return (
    <span {...baseProps}>
      {kind === 'value-string' ? '"' : ''}
      {parts.map((p, i) =>
        p.hit
          ? <mark key={i} className="response-search-highlight" data-search-hit="true">{p.t}</mark>
          : <span key={i}>{p.t}</span>
      )}
      {kind === 'value-string' ? '"' : ''}
    </span>
  );
}
```

For string values, the library's default `String` component wraps the value in quotes via the `ValueQuote` component. Since we're taking over rendering, add literal `"` around the content (`kind === 'value-string'`). For keys, no quotes. For booleans/numbers/null, no quotes.

If Agent B finds the default styling (color, italics, padding) drifts from the library's native output, copy the relevant inline styles from `node_modules/@uiw/react-json-view/cjs/types/String.js` / `KeyName.js` — but the `{...baseProps}` spread should already carry most of it.

### Active-match effect
After each render, a `useEffect` queries the DOM for `[data-search-hit="true"]`, removes `--active` from all, adds it to the one at `searchActiveIndex`, scrolls it into view.

```js
useEffect(() => {
  if (!searchOpen || !rootRef.current) return;
  const hits = rootRef.current.querySelectorAll('[data-search-hit="true"]');
  hits.forEach(h => h.classList.remove('response-search-highlight--active'));
  if (hits.length === 0) return;
  const target = hits[Math.min(searchActiveIndex, hits.length - 1)];
  target?.classList.add('response-search-highlight--active');
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}, [searchOpen, searchQuery, searchActiveIndex, jsonViewKey]);
```

### Hotkey capture (Ctrl+F / Cmd+F / Escape)
Attach to the existing root `<div className="response-viewer">`:

```jsx
<div
  ref={rootRef}
  className="response-viewer"
  tabIndex={-1}
  onKeyDown={(e) => {
    const isFind = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f';
    if (isFind && isJsonBody && !isExample) {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.key === 'Escape' && searchOpen) {
      e.preventDefault();
      closeSearch();
    }
  }}
>
```

`tabIndex={-1}` lets the root receive focus when clicked; `onKeyDown` on the root captures keystrokes from any focused descendant. Ctrl+F outside the viewer does nothing — browser Find works normally.

### Open / close helpers
```js
const openSearch = () => {
  setSearchOpen(true);
  requestAnimationFrame(() => searchInputRef.current?.focus());
};
const closeSearch = () => {
  setSearchOpen(false);
  setSearchQuery('');
  setSearchActiveIndex(0);
};
```

### The float dock
The dock sits inside the JSON viewer, pinned to the top-right, floating over the content. It does NOT scroll with the body.

**Structure change** — wrap the existing `<div className="json-view-wrapper">...</div>` in a new `<div className="response-json-container">` that provides `position: relative` anchor:

```jsx
{isJsonBody && !isExample && (
  <div className="response-json-container">
    <div className="response-json-dock" data-testid="response-json-dock">
      {searchOpen ? (
        <>
          <Search size={12} className="response-json-dock-search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            className="response-json-dock-input"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchActiveIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) gotoPrev(); else gotoNext();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
              }
            }}
            data-testid="response-search-input"
          />
          <span className="response-json-dock-count" data-testid="response-search-count">
            {searchMatches.length === 0
              ? (searchQuery ? '0 / 0' : '')
              : `${Math.min(searchActiveIndex, searchMatches.length - 1) + 1} / ${searchMatches.length}${searchMatches.length >= 5000 ? '+' : ''}`}
          </span>
          <button
            className="response-json-dock-btn"
            onClick={gotoPrev}
            disabled={searchMatches.length === 0}
            title="Previous match (Shift+Enter)"
            data-testid="response-search-prev"
            aria-label="Previous match"
          >
            <ChevronUp size={12} />
          </button>
          <button
            className="response-json-dock-btn"
            onClick={gotoNext}
            disabled={searchMatches.length === 0}
            title="Next match (Enter)"
            data-testid="response-search-next"
            aria-label="Next match"
          >
            <ChevronDown size={12} />
          </button>
          <button
            className="response-json-dock-btn"
            onClick={closeSearch}
            title="Close (Esc)"
            data-testid="response-search-close"
            aria-label="Close search"
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <button
            className="response-json-dock-btn"
            onClick={openSearch}
            title="Search (Ctrl+F)"
            data-testid="response-search-btn"
            aria-label="Search response"
          >
            <Search size={12} />
          </button>
          <button
            className="response-json-dock-btn"
            onClick={handleExpandAll}
            title="Expand all"
            data-testid="response-expand-all-btn"
            aria-label="Expand all"
          >
            <ChevronsUpDown size={12} />
          </button>
          <button
            className="response-json-dock-btn"
            onClick={handleCollapseAll}
            title="Collapse all"
            data-testid="response-collapse-all-btn"
            aria-label="Collapse all"
          >
            <ChevronsDownUp size={12} />
          </button>
        </>
      )}
    </div>

    <div className="json-view-wrapper">
      <JsonView key={jsonViewKey} value={jsonBody} ...>
        {/* existing Null / Undefined / Nan workaround renders + new String / KeyName / True / False / Int / Float renders */}
      </JsonView>
    </div>
  </div>
)}
```

Test-ids **preserved exactly** from Feature 1: `response-search-btn`, `response-expand-all-btn`, `response-collapse-all-btn`. New for Feature 2: `response-json-dock`, `response-search-input`, `response-search-count`, `response-search-prev`, `response-search-next`, `response-search-close`.

### Icon imports
Add to the existing `lucide-react` import on line 2 (`ChevronsUpDown`/`ChevronsDownUp` are already imported from Feature 1): `Search`, `ChevronUp`, `ChevronDown`, `X`.

### Navigation handlers
```js
const gotoNext = () => {
  if (searchMatches.length === 0) return;
  setSearchActiveIndex(i => (i + 1) % searchMatches.length);
};
const gotoPrev = () => {
  if (searchMatches.length === 0) return;
  setSearchActiveIndex(i => (i - 1 + searchMatches.length) % searchMatches.length);
};
```

### Reset policies
- **New response arrives** (`displayResponse` changes): Feature 1's reset effect already bumps `jsonViewKey` and resets `collapseMode`. Extend to also `setSearchOpen(false); setSearchQuery(''); setSearchActiveIndex(0);`.
- **Body becomes non-JSON or switches to example mode**: `useEffect` on `[isJsonBody, isExample]` → if `searchOpen && (!isJsonBody || isExample)`, auto-close.
- **Query cleared to empty string**: match list empties naturally via `useMemo`. Force-expand set becomes `null`. JsonView re-mounts with `collapsed={false}` (or `true` if user is in `all-collapsed` mode).
- **Escape key** when search is open (anywhere inside viewer): closes and clears.
- **Close button**: same.

### CSS (append to `src/styles/response-viewer.css`)

```css
/* JSON container — positioning anchor for the float dock */
.response-json-container {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.response-json-container .json-view-wrapper {
  /* overrides earlier block: drop flex so container controls sizing */
  flex: 1;
  min-height: 0;
}

/* Float dock — pinned top-right, floats over the JSON */
.response-json-dock {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  max-width: calc(100% - 24px);
  transition: width 0.15s ease;
}

.response-json-dock-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.12s ease;
}

.response-json-dock-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-primary);
}

.response-json-dock-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.response-json-dock-search-icon {
  color: var(--text-tertiary);
  margin-left: 4px;
  margin-right: 2px;
  flex-shrink: 0;
}

.response-json-dock-input {
  flex: 1;
  min-width: 0;
  width: 200px;
  max-width: 280px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 0;
}

.response-json-dock-input::placeholder {
  color: var(--text-tertiary);
}

.response-json-dock-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 0 4px;
  min-width: 44px;
  text-align: right;
  white-space: nowrap;
}

/* Match highlight — preserves library's colored token text color via `inherit` */
.response-search-highlight {
  background: color-mix(in srgb, var(--accent-warning) 28%, transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
  display: inline;
  scroll-margin-top: 52px; /* leave room above for the dock when scrollIntoView fires */
  scroll-margin-bottom: 12px;
}

.response-search-highlight--active {
  background: var(--accent-warning);
  color: #0f172a;
  outline: 1px solid var(--accent-warning);
}
```

If `--accent-warning` / `--bg-elevated` / `--shadow-sm` / `color-mix` aren't defined, Agent B should check `src/styles/variables.css` and fall back to solid `#f59e0b` / `rgba(245,158,11,0.28)` / a hand-rolled `box-shadow`.

## Acceptance Criteria

**AC1 — Default render is fully expanded**
- Given a JSON response with nested objects ≥ 4 levels deep, the initial render shows every level expanded. No `Ellipsis` glyph visible.
- Consequence: Feature 1's E2E test `expand-all-reveals-deep-nodes` becomes trivially true on initial render. The `reset-on-new-response` test needs to flip: after re-sending, the viewer is still fully expanded (not `collapsed={2}`). Updated assertions are part of this feature's E2E spec below.

**AC2 — Float dock visible in top-right of JSON viewer**
- `[data-testid="response-json-dock"]` is visible for JSON responses in non-example mode.
- The dock is positioned inside the `.response-json-container` with `position: absolute; top; right`. Verified by the computed style OR simply by asserting the dock is visible above the JSON content.
- The dock is hidden for HTML / image / PDF / plain-text / example modes.

**AC3 — Dock shows three icons at rest**
- When `searchOpen === false`, the dock contains exactly `[data-testid="response-search-btn"]`, `[data-testid="response-expand-all-btn"]`, `[data-testid="response-collapse-all-btn"]` in that order.

**AC4 — Toolbar no longer contains expand/collapse**
- `.response-meta` in the DOM no longer contains `response-expand-all-btn` or `response-collapse-all-btn` as descendants. Those test-ids exist ONLY inside `[data-testid="response-json-dock"]`.
- `response-download-btn` remains in `.response-meta`.

**AC5 — Clicking search icon opens search bar in the dock**
- Clicking `[data-testid="response-search-btn"]` swaps the dock contents to: search icon, text input, counter, prev, next, close.
- Focus lands in `[data-testid="response-search-input"]`.
- Input, counter, prev/next/close buttons are visible with their stated test-ids.

**AC6 — Ctrl+F opens search from inside the viewer**
- With focus anywhere inside the ResponseViewer (e.g. on the root div or a descendant), pressing `Ctrl+F` (or `Cmd+F` on macOS) opens the search bar AND calls `preventDefault`. Focus is in the search input.

**AC7 — Ctrl+F outside the viewer is inert**
- With focus in the sidebar search input (outside the ResponseViewer), pressing Ctrl+F does NOT open the response search bar. Browser Find behaves normally.

**AC8 — Hotkey gated by body type**
- If `isJsonBody === false`, Ctrl+F inside the viewer does NOT open the search bar.

**AC9 — Finds matches inside (previously) collapsed nodes, after user collapses-all**
- Given a JSON body with `{ users: [{ email: "alice@example.com" }] }` initially rendered fully expanded:
  - Click Collapse-all → `users` contents are hidden; "alice" text is absent from the DOM.
  - Open search, type "alice" → `searchMatches.length >= 1` AND the path `users[0].email` force-expands so "alice" becomes visible, wrapped in a `<mark data-search-hit="true">`.

**AC10 — Numeric substring match**
- Given `{ code: 123 }`, query `"12"` produces at least one match and the "123" value has a visible `<mark>` around the `"12"` substring.

**AC11 — Boolean substring match**
- Given `{ active: true }`, query `"tru"` matches. The `true` token visibly highlights the `"tru"` substring. Same for `{ flag: "true" }` (string value).

**AC12 — Null substring match**
- Given `{ empty: null }`, query `"ull"` matches. The rendered `null` token highlights `"ull"`.

**AC13 — Key substring match**
- Given `{ emailAddress: "…" }`, query `"ema"` matches the key and highlights `"ema"` inside the key name.

**AC14 — Case-insensitive**
- Queries `ALICE`, `alice`, `Alice` all produce the same match set on the same body.

**AC15 — Match counter format**
- Counter `[data-testid="response-search-count"]` reads:
  - Empty string when query is empty
  - `0 / 0` when query has no matches
  - `N / M` with N = active 1-based index, M = total matches
  - `N / 5000+` when the 5000-match cap is reached

**AC16 — Next / previous navigation with wrap**
- Clicking `[data-testid="response-search-next"]` advances active index. From last match it wraps to first. Prev is symmetric.
- Enter key in the input advances; Shift+Enter retreats.
- Buttons are disabled when `searchMatches.length === 0`.

**AC17 — Active match visibly distinct and scrolled into view**
- Exactly one `<mark class="response-search-highlight--active">` exists at any time when there are matches.
- After navigation, the active element is within the `.json-view-wrapper` viewport (test via `element.getBoundingClientRect()` being within the wrapper's rect).

**AC18 — Escape closes and clears**
- With focus in the search input, Escape closes the search, clears the query, drops all highlights, returns the dock to its 3-icon state.
- With focus elsewhere inside the viewer (e.g. on the json-view-wrapper itself) AND search open, Escape also closes.

**AC19 — Close button equivalent to Escape**
- Clicking `[data-testid="response-search-close"]` closes and clears identically.

**AC20 — New response resets search**
- If search is open with an active query, re-sending the request (or switching to a different response) closes the search bar and clears its state. No highlights remain.

**AC21 — Collapse-all / Expand-all still work**
- From the dock's 3-icon rest state, clicking Collapse-all → everything collapses to top level (single root expanded).
- Clicking Expand-all → everything re-expands.
- These work regardless of whether a search is or was active.

**AC22 — Existing null/undefined/NaN library workaround preserved**
- Values of `null`, `undefined`, `NaN` still render their text in the JsonView. The existing `JsonView.Null` / `JsonView.Undefined` / `JsonView.Nan` render overrides are NOT removed or broken.

**AC23 — Long strings not truncated past a match**
- With search active, the library's `shortenTextAfterLength` is effectively disabled (`{0}`) so long string values like a 100-char bio render in full and the user can see the match.

**AC24 — No regression on non-JSON**
- HTML preview / image preview / PDF preview / raw `<pre>` fallback / Download button all unchanged.

## Test Plan

### E2E test — create new `e2e/response-viewer-search.spec.ts`
Reuse the `createTestRequest` / `sendRequestAndWaitForResponse` helpers from `e2e/response-viewer-expand-collapse.spec.ts` (or import them if that file exposes them; otherwise duplicate for isolation).

`httpbin.org/json` is the 4-level-deep fixture:
```
{ slideshow: { title: "Sample Slide Show", author: "Yours Truly", date: "date of publication",
   slides: [
     { title: "Wake up to WonderWidgets!", type: "all" },
     { title: "Overview", type: "all", items: [
         "Why <em>WonderWidgets</em> are great",
         "Who <em>buys</em> WonderWidgets"
   ]}]
}}
```

1. **`dock-visible-for-json`** — Send JSON. Assert `[data-testid="response-json-dock"]` visible.
2. **`dock-hidden-for-html`** — Send HTML (httpbin.org/html). Assert dock zero count.
3. **`dock-hidden-in-example`** — Open an example. Assert dock zero count.
4. **`dock-shows-three-icons-at-rest`** — In rest state, assert search, expand-all, collapse-all test-ids exist **inside** the dock. Assert they do NOT exist inside `.response-meta`.
5. **`toolbar-still-has-download-only`** — Download button still in `.response-meta`. Expand/collapse test-ids NOT inside `.response-meta`.
6. **`icon-click-opens-search-bar`** — Click magnifier. Input focused. Prev/next/close/count all present.
7. **`ctrlf-opens-search-inside-viewer`** — Focus json-view-wrapper, press Ctrl+F. Search opens.
8. **`ctrlf-outside-viewer-noop`** — Focus sidebar search, press Ctrl+F. Response search bar NOT visible.
9. **`default-render-is-expanded`** — Fresh response, no user action. Deep string "WonderWidgets" is already visible (this differs from Feature 1's original `expand-all-reveals-deep-nodes` behavior).
10. **`finds-match-after-collapse-all`** — Click Collapse-all → "WonderWidgets" absent. Open search, type "WonderWidgets" → match visible again.
11. **`number-substring-match`** — Need a response with a numeric value. Use a collection variable or a POST-reflect endpoint (or add a simple httpbin endpoint / fixture). Example: save an example with body `{"code": 12345}`, open it (but examples are out of scope…). **Agent A alternative**: use `httpbin.org/anything?num=12345` which echoes the query — the response body contains `"num": "12345"` as a string value. Query "34" must highlight inside that string. (This tests the same code path as numeric-body matching because both run through `renderHighlightedText`.)
12. **`boolean-substring-match`** — httpbin `/anything` body contains booleans; alternatively `{"active": true}` fixture. Query "tru" highlights. If Agent A can't find a stable boolean fixture, skip with a `test.fixme` and add an implementation-note comment; Agent B can provide a fixture via a local file.
13. **`key-substring-match`** — httpbin.org/json has key `slideshow`. Query "slide" highlights the key.
14. **`case-insensitive`** — Query `WONDER` produces same match count as `wonder`.
15. **`counter-format`** — Empty query → counter empty. Query with no matches → `0 / 0`. Query with 4 matches → counter reads `1 / 4` initially.
16. **`next-wraps-from-last`** — 4 matches. Click next 3 times (to index 4 / total 4). Click next once more → counter reads `1 / 4`.
17. **`prev-wraps-from-first`** — Same setup. Initial index 1. Click prev → counter reads `4 / 4`.
18. **`enter-advances-shift-enter-retreats`** — Focus the search input. Enter advances. Shift+Enter retreats.
19. **`active-highlight-unique`** — With ≥ 1 matches, exactly one `.response-search-highlight--active` at any time.
20. **`escape-closes-search`** — Open search with query. Press Escape. Search bar gone, dock back to 3 icons, `<mark>` count = 0.
21. **`close-button-closes`** — Click `[data-testid="response-search-close"]`. Same as Escape.
22. **`new-response-closes-search`** — Open search with query. Re-send. Search bar gone, query cleared.
23. **`collapse-all-via-dock-then-expand-all`** — From rest, click Collapse-all → deep text gone. Click Expand-all → deep text visible.

### Feature 1 regression (update `e2e/response-viewer-expand-collapse.spec.ts`)
Two tests need updated assertions because the default is now expand-all:

- **`expand-all-reveals-deep-nodes`** — Original assertion "deep text absent initially, present after Expand-all" is no longer meaningful since default IS expanded. Update to: click Collapse-all → deep text absent; click Expand-all → deep text visible. Keep the test id / name as-is for traceability.
- **`reset-on-new-response`** — Original: "click Expand-all, re-send, deep text absent". New behavior: after re-send the viewer is STILL fully expanded (default). Rewrite to: click Collapse-all, verify deep text absent, re-send, verify deep text is visible again (collapse state didn't carry over).

All other Feature 1 tests (`expand-collapse-visible-for-json`, `expand-collapse-hidden-for-html`, `expand-collapse-hidden-in-example`, `collapse-all-collapses-nested`, `download-button-coexists`) continue to work because they target test-ids that still exist (now inside the dock instead of the toolbar).

Agent B: DO NOT touch `e2e/response-viewer-expand-collapse.spec.ts`. That's Agent A's job as part of this feature's scope.

### Regression (other existing E2E)
- `e2e/response-download.spec.ts` — must still pass.
- `e2e/html-preview.spec.ts`, `e2e/image-preview.spec.ts`, `e2e/pdf-preview.spec.ts`, `e2e/binary-toggle.spec.ts` — must still pass.

## Implementation Order

1. Remove Feature 1's toolbar buttons from `.response-meta`.
2. Change Feature 1's default `collapseMode` to `'all-expanded'` and simplify the `collapsed` ternary.
3. Add new state (search).
4. `findJsonMatches` + `renderHighlightedText` helpers.
5. Wrap `.json-view-wrapper` in `.response-json-container`.
6. Dock render (rest state + search state).
7. JsonView wiring: conditional `collapsed` vs `shouldExpandNodeInitially`, `shortenTextAfterLength`, key bumping, custom `String` / `KeyName` / `True` / `False` / `Int` / `Float` renderers (extend existing `Null` / `Undefined` / `Nan`).
8. Hotkey capture on root.
9. Active-match scroll effect.
10. Reset effects (new response, body-type change).
11. CSS.
12. E2E (Agent A): write `e2e/response-viewer-search.spec.ts` + update two tests in `e2e/response-viewer-expand-collapse.spec.ts`.

## Risks & Notes

- **Dock covering content** — The dock floats over the JSON. In very narrow viewports the dock in search mode (input expands to ~280px) could obscure JSON content. Mitigation: `max-width: calc(100% - 24px)` clamps it to the container; the input has `min-width: 0` so it shrinks gracefully. Don't over-engineer.
- **`scrollIntoView` under a floating dock** — `scroll-margin-top: 52px` on `.response-search-highlight` so centered-scroll leaves room for the dock at the top. If the dock's actual rendered height differs, adjust the margin. Use a fixed value; this isn't worth a dynamic measurement.
- **Library render-prop return semantics** — Returning `null` to fall through to the default is already in use (`JsonView.Null`). Agent B: confirm this also works for `String` / `KeyName` / primitives by testing in the browser. If `String`'s render-prop has different semantics, check `node_modules/@uiw/react-json-view/cjs/types/String.js` for the signature.
- **Color tokens inside highlight** — `.response-search-highlight { color: inherit }` keeps library color (green for strings, blue for keys, orange for numbers, etc.) so the match still looks typed correctly.
- **Performance on huge JSON** — DFS walking is cheap; the cost is JsonView re-mount on every keystroke. For v1, no debounce — ship plain. If it feels laggy on real-world responses Agent B may add `useDeferredValue(searchQuery)` (React 18) or a 120ms debounce. Don't premature-optimize.
- **Multi-occurrence per string** — `findJsonMatches` emits one entry per occurrence; `renderHighlightedText` emits one `<mark>` per occurrence; DOM count equals `searchMatches.length` (up to the 5000 cap). They stay in sync.
- **Remount on every toggle** — Known limitation. When the user escapes search, the JsonView remounts with `collapsed={false}` (all-expanded, the default now), losing any manual branch-level collapses the user had done. Acceptable for v1; the default is fully expanded anyway so most users won't notice.
