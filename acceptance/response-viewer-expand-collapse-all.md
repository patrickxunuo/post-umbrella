# Acceptance Spec: Response Viewer — Expand-all / Collapse-all

## Problem
`src/components/ResponseViewer.jsx` renders JSON responses through `<JsonView ... collapsed={2}>` (line 464–509). Users can only toggle one node at a time. Large responses force the user to click through every `{}` / `[]`. There is no one-click way to flip every level open or closed.

## Scope
Edit only:
- `src/components/ResponseViewer.jsx` — toolbar buttons + state + `JsonView` re-mount key
- `src/styles/response-viewer.css` — icon-button styles (or reuse existing `.response-download-btn` class)

No changes to data layer, hooks, or other components. No dependency on Feature 2/3 — this ships standalone.

Out of scope:
- Search or highlight (Feature 2).
- Raw-text branches — buttons only render for JSON.
- Example-editing mode (`isExample === true` uses `JsonEditor`, not `JsonView`).

## Interface Contract

### State
Add to `ResponseViewer`:
```js
// 'default' (collapsed={2}), 'all-collapsed' (collapsed=true), 'all-expanded' (collapsed=false)
const [collapseMode, setCollapseMode] = useState('default');
const [jsonViewKey, setJsonViewKey] = useState(0);
```

### Reset on new response
Extend the existing `useEffect` on `displayResponse` (currently at lines 147–151 for binary-view resets) — or add a peer effect — to reset `collapseMode` to `'default'` and bump `jsonViewKey` when a new response arrives. This prevents carryover when switching tabs / re-sending.

### Handlers
```js
const handleExpandAll = () => {
  setCollapseMode('all-expanded');
  setJsonViewKey(k => k + 1);
};
const handleCollapseAll = () => {
  setCollapseMode('all-collapsed');
  setJsonViewKey(k => k + 1);
};
```

### Toolbar buttons
Rendered inside `.response-meta` (the right-hand toolbar group) **only** when `isJsonBody === true` AND `!isExample`, placed **before** the existing Download button so the layout reads `[expand] [collapse] [download]`.

```jsx
{!isExample && isJsonBody && (
  <>
    <button
      className="response-toolbar-btn response-expand-all-btn"
      onClick={handleExpandAll}
      title="Expand all"
      data-testid="response-expand-all-btn"
      aria-label="Expand all"
    >
      <ChevronsUpDown size={12} />
    </button>
    <button
      className="response-toolbar-btn response-collapse-all-btn"
      onClick={handleCollapseAll}
      title="Collapse all"
      data-testid="response-collapse-all-btn"
      aria-label="Collapse all"
    >
      <ChevronsDownUp size={12} />
    </button>
  </>
)}
```

Imports: add `ChevronsUpDown`, `ChevronsDownUp` to the existing `lucide-react` import on line 2.

### JsonView wiring
Change the existing `<JsonView value={jsonBody} ... collapsed={2}>` at line ~464 to:

```jsx
<JsonView
  key={jsonViewKey}
  value={jsonBody}
  collapsed={
    collapseMode === 'all-expanded' ? false
    : collapseMode === 'all-collapsed' ? true
    : 2
  }
  /* remaining props unchanged */
>
```

The `key` forces a fresh mount when the mode changes so `collapsed` (which only takes effect on initial render per library docs) re-applies.

### CSS (`src/styles/response-viewer.css`)
Introduce a shared `.response-toolbar-btn` class mirroring `.response-download-btn`'s look, so the three icons visually form a group. Refactor `.response-download-btn` to extend the shared class (via CSS selector list) so the existing button keeps its current appearance. No visual regression on the Download button.

```css
.response-toolbar-btn,
.response-download-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  background: transparent;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: var(--space-1);
}

.response-toolbar-btn:hover,
.response-download-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-secondary);
}

.response-toolbar-btn:active,
.response-download-btn:active {
  transform: scale(0.96);
}
```

(If `.response-download-btn` already has these rules — it does, at lines 1239–1261 — the new block just adds `.response-toolbar-btn` to each selector list. Agent B MUST keep the existing Download styling unchanged.)

## Acceptance Criteria

**AC1 — Buttons only render for JSON responses (live)**
- Given a non-example tab with a successful response whose body is a valid JSON object or JSON-parseable string, both `[data-testid="response-expand-all-btn"]` and `[data-testid="response-collapse-all-btn"]` are visible in the response toolbar.
- Given a non-JSON response (HTML, image, PDF, plain text), both buttons have zero count.

**AC2 — Buttons hidden in example-editing mode**
- Given `isExample === true`, both buttons have zero count regardless of body content.

**AC3 — Buttons hidden before any response**
- Given no response yet (`displayResponse` is null), both buttons have zero count.

**AC4 — Collapse-all collapses every level**
- Given a JSON response rendered with default collapse depth 2 (so level-3+ nodes are initially closed), clicking Collapse-all MUST result in a DOM where every top-level value is collapsed. Specifically: the `[data-testid="w-rjv-wrap"]` shows only root-level keys; no nested object/array contents are visible.

**AC5 — Expand-all expands every level**
- Given a JSON response with nested objects/arrays at least 3 levels deep, clicking Expand-all MUST render every nested object/array with its contents visible. No `Ellipsis` glyph from the library remains.

**AC6 — Toggle between states works in either order**
- Sequence `Expand-all → Collapse-all`: ends fully collapsed.
- Sequence `Collapse-all → Expand-all`: ends fully expanded.
- The buttons never become disabled between clicks.

**AC7 — Reset on new response**
- If the user clicks Expand-all, then re-sends the request (or switches to a different request tab), the new response renders with the default `collapsed={2}` view — NOT the previous expand-all state.

**AC8 — Download button regression**
- The existing `[data-testid="response-download-btn"]` remains visible, clickable, and visually identical (same border, padding, hover color). The three buttons sit together in a group with consistent spacing.

**AC9 — No regression on non-JSON response types**
- HTML preview toggle still shows Preview/Raw buttons as before.
- Image preview / raw / hex toggle unchanged.
- PDF preview / raw / hex toggle unchanged.
- Plain-text `<pre>` fallback unchanged.

## Test Plan

### E2E test — new file `e2e/response-viewer-expand-collapse.spec.ts`

Use an existing pattern from `e2e/response-download.spec.ts` or `e2e/html-preview.spec.ts` for request-send harness. A JSON-returning request is needed — `https://httpbin.org/json` via the proxy works, or reuse an existing fixture that produces nested JSON.

1. **`expand-collapse-visible-for-json`** — Send a request returning JSON. Assert both buttons are visible in the toolbar.
2. **`expand-collapse-hidden-for-html`** — Send a request returning `text/html`. Assert both buttons have zero count.
3. **`expand-collapse-hidden-in-example`** — Open a saved example tab. Assert both buttons have zero count.
4. **`collapse-all-collapses-nested`** — JSON response with nested object `{ a: { b: { c: 1 } } }`. Initially `b.c` is hidden (collapsed={2} hides depth 3+). Click Expand-all — assert `c: 1` text is visible in the DOM. Click Collapse-all — assert `c`, `b` keys are NOT visible; only root-level keys (`a`) remain.
5. **`expand-all-reveals-deep-nodes`** — Direct test for AC5 using a body with 4+ levels of nesting.
6. **`reset-on-new-response`** — Click Expand-all, then re-send a fresh request. Assert deep-nested text is NOT immediately visible (default collapse depth restored).
7. **`download-button-coexists`** — Button trio visible and clickable. Just verify DOM presence + click Download to make sure it still works (spot-check AC8).

### Regression (existing E2E)
- `e2e/response-download.spec.ts` — still passes.
- `e2e/html-preview.spec.ts` — still passes (no buttons added to HTML-preview branch).
- `e2e/image-preview.spec.ts`, `e2e/pdf-preview.spec.ts`, `e2e/binary-toggle.spec.ts` — all pass.

## Implementation Order

1. CSS: refactor `.response-download-btn` rules into shared `.response-toolbar-btn, .response-download-btn` selectors.
2. `ResponseViewer.jsx`: imports, state, handlers, buttons, `JsonView` key + `collapsed` wiring.
3. E2E spec (Agent A).

## Risks & Notes
- **`collapsed` prop precedence** — per `@uiw/react-json-view` docs, `collapsed` takes precedence over `shouldExpandNodeInitially`. Feature 2 will need to work around this by using `shouldExpandNodeInitially` for per-match forced expansion AND leaving `collapsed={false}` (or unset) when search is active. That's a Feature-2 concern; this feature is free to use `collapsed` straightforwardly.
- **Re-mount cost** — bumping `key` unmounts and re-mounts the JSON tree, losing scroll position. Acceptable for expand/collapse-all (the user is explicitly asking to reset the view).
- **Icon choice** — `ChevronsUpDown` (expand) and `ChevronsDownUp` (collapse) match the sidebar convention (`sidebar-expand-collapse-with-search.md` AC6 note). Stay consistent.
