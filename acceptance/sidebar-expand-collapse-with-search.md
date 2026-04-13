# Acceptance Spec: Sidebar Expand/Collapse Works During Active Search

## Problem
In `src/components/Sidebar/Sidebar.jsx`:

- Line 656: `const isExpanded = searchQuery.trim() ? true : expandedCollections.has(collection.id);` — while a search query is active, every visible collection is **forced** open regardless of `expandedCollections`.
- Lines 509–517: `handleExpandAll` only expands **root-level** collections (not nested), and `handleCollapseAll` clears the whole set. Both work against the full tree, not the filtered tree.

Net effect: while searching, clicking expand/collapse does nothing the user can see, because the render-time override keeps everything open.

## Scope
Change only `src/components/Sidebar/Sidebar.jsx`. No data-layer or context changes.

Out of scope:
- Persisting a separate "search-mode" expansion state across session (localStorage currently persists `expandedCollections` — keep it that way).
- Changing filter logic.
- `expandedRequests` (requests-level expansion for examples) — fine as-is.

## Interface Contract

### Remove the render-time override
Change line 656 from:
```js
const isExpanded = searchQuery.trim() ? true : expandedCollections.has(collection.id);
```
to:
```js
const isExpanded = expandedCollections.has(collection.id);
```

### Auto-seed `expandedCollections` on search start
Add a `useEffect` keyed on `searchQuery` that, when `searchQuery.trim()` transitions from empty → non-empty OR when the query changes, computes the set of all matching collection IDs + their ancestors and merges them into `expandedCollections`. This preserves the current "everything relevant opens automatically while searching" UX.

```js
useEffect(() => {
  if (!searchQuery.trim()) return;
  const toExpand = new Set();
  const walk = (col) => {
    if (!col) return false;
    const selfMatches = collectionMatchesSearch(col);
    const reqMatches = filterRequests(col.requests).length > 0;
    const children = getChildCollections(col.id);
    let childMatched = false;
    for (const child of children) {
      if (walk(child)) childMatched = true;
    }
    const matched = selfMatches || reqMatches || childMatched;
    if (matched) toExpand.add(col.id);
    return matched;
  };
  const rootCollections = collections.filter(c => !c.parent_id);
  for (const root of rootCollections) walk(root);
  setExpandedCollections(prev => new Set([...prev, ...toExpand]));
  // Intentionally depend on searchQuery — auto-seed on every query change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchQuery, collections]);
```

### Make `handleExpandAll` / `handleCollapseAll` search-aware
```js
// Return IDs of collections visible under current search (matching or on a matching ancestry path).
const getVisibleCollectionIds = () => {
  const visible = new Set();
  const walk = (col) => {
    if (!col) return false;
    if (!searchQuery.trim()) { visible.add(col.id); getChildCollections(col.id).forEach(walk); return true; }
    const selfMatches = collectionMatchesSearch(col);
    const reqMatches = filterRequests(col.requests).length > 0;
    const children = getChildCollections(col.id);
    let childMatched = false;
    for (const child of children) if (walk(child)) childMatched = true;
    const matched = selfMatches || reqMatches || childMatched;
    if (matched) visible.add(col.id);
    return matched;
  };
  collections.filter(c => !c.parent_id).forEach(walk);
  return visible;
};

const handleExpandAll = () => {
  setExpandedCollections(new Set(getVisibleCollectionIds()));
};

const handleCollapseAll = () => {
  if (!searchQuery.trim()) {
    setExpandedCollections(new Set());
    return;
  }
  // During search: collapse only visible (matching) collections; leave unrelated state intact.
  const visible = getVisibleCollectionIds();
  setExpandedCollections(prev => {
    const next = new Set(prev);
    for (const id of visible) next.delete(id);
    return next;
  });
};
```

### Skip-render guard still correct
Line 640's guard `if (searchQuery.trim() && !showAll && !hasMatchingRequests(collection)) return null;` is unchanged — non-matching collections still hide.

### Visual result while searching
- Initially (just after typing): all matching + ancestor collections auto-expanded (preserves current UX).
- Click **collapse-all**: matching collections fold to headers only; non-matching branches remain hidden (still filtered out by the render guard). User sees only root-level matching collection headers.
- Click one collection header: it expands (no longer overridden). User can drill down manually.
- Click **expand-all**: all matching collections + their ancestors unfold again.
- Clear the search: `expandedCollections` is whatever state it was in when user was searching — this is acceptable and matches how most tree UIs behave.

## Acceptance Criteria

### AC1 — Typing a search query still auto-expands matching branches
Given a collection `Parent > Child > leaf-request` where `leaf-request` matches the query, the tree visually shows all three levels. (Unchanged user-visible behavior.)

### AC2 — Collapse-all during search collapses matching headers
Given query "api" that matches requests inside 3 different collections (all currently expanded), clicking collapse-all MUST visually collapse all three: only collection headers are visible, no request items.

### AC3 — Expand-all during search re-expands all matching collections
After AC2 scenario, clicking expand-all MUST re-expand all three matching collections, showing their matched requests.

### AC4 — Individual expand click works during search
During a search, clicking the chevron on a collapsed matching collection expands just that one. Clicking again collapses it. Other matching collections remain in their current state.

### AC5 — Clearing search restores a usable state
After searching and clicking collapse-all, clearing the search input MUST not throw and MUST show the tree in some consistent expanded state (specifically: whatever `expandedCollections` now contains — acceptable).

### AC6 — Regression: expand-all without search still expands all (incl. nested)
NEW BEHAVIOR (minor correctness bonus): Without a search, expand-all now expands all nested collections too (not just roots). This fixes an existing minor bug and should be called out in the PR.

### AC7 — Regression: collapse-all without search still clears everything
Without a search, collapse-all collapses all collections. Unchanged.

### AC8 — No regression in rendering
Existing tests for sidebar behavior still pass: request-send, collection-nested, workflow sidebar tests. No CSS/DOM changes beyond expand state.

## Test Plan

### E2E test — extend `e2e/collection.spec.ts` or new `e2e/sidebar-search.spec.ts`

1. **sidebar-search-expand-all** — Create collections `A`, `B`, `C`, each with a request matching "needle". Type "needle" in sidebar search. Click collapse-all. Assert no `.request-item` is visible. Click expand-all. Assert all 3 matching requests are visible.
2. **sidebar-search-individual-toggle** — With search active and collapse-all clicked, click the chevron on `A`'s header. Assert `A`'s matching request becomes visible, `B` and `C` stay collapsed.
3. **sidebar-expand-all-nested-no-search** — Create `Root > Child > request`. Click expand-all with no search. Assert both `Root` and `Child` are expanded (the AC6 correctness bonus).

Data-testid additions (optional, keep existing selectors if they already work):
- `data-testid="sidebar-expand-all"` on the expand-all button (ChevronsUpDown).
- `data-testid="sidebar-collapse-all"` on the collapse-all button (ChevronsDownUp).
- `data-testid="sidebar-search-input"` on the search `<input>`.

### Regression
- `e2e/collection.spec.ts`, `e2e/workflow.spec.ts`, `e2e/request.spec.ts` — all must still pass.
