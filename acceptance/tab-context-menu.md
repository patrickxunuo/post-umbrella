# Acceptance Spec: Tab Context Menu

## Problem
Tabs can only be closed one at a time via the tab's × button. Users with many tabs open need bulk close operations.

## Scope
- `src/components/TabBar.jsx` — `onContextMenu` on `.open-tab`, menu popover, outside-click + Escape dismiss
- `src/hooks/useRequestActions.js` — new `closeManyTabs(ids, options)` action + shared `computeNextActiveTabId` helper; existing `closeTab` updated to use it
- `src/components/ConfirmModal.jsx` — optional `listItems` prop rendered as a `<ul>` under the message string
- `src/App.css` — `.tab-context-menu` styles reusing the `.request-menu` pattern

Out of scope:
- Reorder / pin / duplicate tab operations
- Keyboard shortcuts for these operations
- Changing the × button behavior

## Interface Contract

### 1. Shared focus helper — `src/hooks/useRequestActions.js`

```js
// Given the tab list as it was BEFORE closing, the ids being closed, and the
// current active tab id, return the id that should be active after the close.
// Rule: if current active is not being closed, keep it. Otherwise focus the
// nearest remaining tab to the right of the closed-active tab's original
// position; fall back to the nearest remaining tab on the left. Return null
// if no tabs remain.
function computeNextActiveTabId(tabsBefore, closedIds, currentActiveId) {
  const closedSet = closedIds instanceof Set ? closedIds : new Set(closedIds);
  const remaining = tabsBefore.filter(t => !closedSet.has(t.id));
  if (remaining.length === 0) return null;
  if (currentActiveId && !closedSet.has(currentActiveId)) return currentActiveId;

  // Active was closed — find where it was and scan right, then left.
  const activeIndex = tabsBefore.findIndex(t => t.id === currentActiveId);
  if (activeIndex < 0) return remaining[0].id;
  for (let i = activeIndex + 1; i < tabsBefore.length; i++) {
    if (!closedSet.has(tabsBefore[i].id)) return tabsBefore[i].id;
  }
  for (let i = activeIndex - 1; i >= 0; i--) {
    if (!closedSet.has(tabsBefore[i].id)) return tabsBefore[i].id;
  }
  return remaining[0].id;
}
```

Existing `closeTab` is refactored to call this helper instead of its current `newTabs[newTabs.length - 1]` rule. (× button behavior is preserved for non-active-tab closes; for active-tab closes, focus now moves to the *right neighbor* rather than the rightmost tab — this is the issue's stated desired behavior, applied consistently to both entry points.)

### 2. New bulk action — `closeManyTabs`

```js
// ids: Iterable<string> of tab ids to close
// opts:
//   force?: boolean              — skip dirty prompt even if skipCloseConfirm is off
//   confirmTitle?: string        — override prompt title
const closeManyTabs = useCallback(async (ids, opts = {}) => {
  const idSet = new Set(ids);
  if (idSet.size === 0) return;

  const tabsBefore = openTabs;
  const closing = tabsBefore.filter(t => idSet.has(t.id));
  const dirtyClosing = closing.filter(t => t.dirty);

  // Single consolidated prompt for dirty tabs
  if (!opts.force && !userConfig?.skipCloseConfirm && dirtyClosing.length > 0) {
    const confirmed = await confirm({
      title: opts.confirmTitle || 'Unsaved Changes',
      message: `You have unsaved changes in ${dirtyClosing.length} tab${dirtyClosing.length === 1 ? '' : 's'}. Close anyway?`,
      listItems: dirtyClosing.map(t => tabDisplayName(t)),
      confirmText: 'Close',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
  }

  // Temp tabs inside the batch: same rule as the × button — close if empty
  // (untouched request with name "New Request" and no url/body), otherwise
  // leave them alone (the existing UnsavedChangesModal flow is per-tab and
  // too intrusive for bulk ops; skip them silently in this version).
  const finalIds = new Set(
    closing
      .filter(t => !t.isTemporary || isEmptyTempRequest(t))
      .map(t => t.id)
  );

  // Compute next active BEFORE mutating state
  const nextActive = computeNextActiveTabId(tabsBefore, finalIds, activeTabId);

  setOpenTabs(prev => prev.filter(t => !finalIds.has(t.id)));
  setActiveTabId(nextActive);

  // Clean up per-tab state (preview, conflicted, deleted, originalRequests)
  for (const id of finalIds) {
    cleanupTabState(id);
  }
}, [openTabs, activeTabId, userConfig, confirm, setOpenTabs, setActiveTabId]);
```

`tabDisplayName(tab)` produces the visible tab label (e.g., "GET /api/users" for request, the workflow name for workflow, collection name for collection — reuse existing tab-label logic from TabBar). `isEmptyTempRequest(tab)` / `cleanupTabState(id)` already exist or are trivially extracted from the current `closeTab`.

### 3. ConfirmModal — list support

Add an optional `listItems?: string[]` prop. When provided:

```jsx
<p className="confirm-message">{message}</p>
{listItems?.length > 0 && (
  <ul className="confirm-list" data-testid="confirm-list">
    {listItems.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
)}
```

CSS:
```css
.confirm-list {
  margin: var(--space-2) 0 0 0;
  padding-left: var(--space-5);
  max-height: 200px;
  overflow-y: auto;
  color: var(--text-secondary);
  font-size: 13px;
}
.confirm-list li {
  padding: 2px 0;
}
```

The 200px cap prevents the modal from growing unbounded when many tabs are dirty.

### 4. TabBar context menu

State (in `TabBar`):
```js
const [menuState, setMenuState] = useState(null);
// menuState = null | { tabId: string, x: number, y: number }
const menuRef = useRef(null);
```

`onContextMenu` on the tab element:
```jsx
<div
  className={`open-tab ...`}
  onContextMenu={(e) => {
    e.preventDefault();
    setMenuState({ tabId: tab.id, x: e.clientX, y: e.clientY });
  }}
  ...
>
```

Outside-click + Escape dismiss (useEffect wired on `menuState`).

Menu render (sibling of the tab strip, not child):
```jsx
{menuState && (() => {
  const clickedId = menuState.tabId;
  const clickedIndex = openTabs.findIndex(t => t.id === clickedId);
  if (clickedIndex < 0) return null;
  const others = openTabs.filter(t => t.id !== clickedId);
  const leftTabs = openTabs.slice(0, clickedIndex);
  const rightTabs = openTabs.slice(clickedIndex + 1);
  const unmodifiedOthers = others.filter(t => !t.dirty);

  const showOthers = others.length > 0;
  const showUnmodified = unmodifiedOthers.length > 0;
  const showLeft = leftTabs.length > 0;
  const showRight = rightTabs.length > 0;

  return (
    <div
      ref={menuRef}
      className="request-menu tab-context-menu"
      style={{ position: 'fixed', top: menuState.y, left: menuState.x, right: 'auto' }}
      data-testid="tab-context-menu"
      role="menu"
    >
      <button className="request-menu-item" data-testid="tab-menu-close" onClick={() => { handleMenuClose(); closeSingleTab(clickedId); }}>Close</button>
      {(showOthers || showUnmodified || showLeft || showRight) && <div className="request-menu-divider" />}
      {showOthers && (
        <button className="request-menu-item" data-testid="tab-menu-close-others" onClick={() => { handleMenuClose(); closeManyTabs(others.map(t => t.id), { confirmTitle: 'Close Other Tabs' }); }}>Close Other Tabs</button>
      )}
      {showUnmodified && (
        <button className="request-menu-item" data-testid="tab-menu-close-unmodified" onClick={() => { handleMenuClose(); closeManyTabs(unmodifiedOthers.map(t => t.id), { force: true }); }}>Close Unmodified Tabs</button>
      )}
      {showLeft && (
        <button className="request-menu-item" data-testid="tab-menu-close-left" onClick={() => { handleMenuClose(); closeManyTabs(leftTabs.map(t => t.id)); }}>Close Tabs to the Left</button>
      )}
      {showRight && (
        <button className="request-menu-item" data-testid="tab-menu-close-right" onClick={() => { handleMenuClose(); closeManyTabs(rightTabs.map(t => t.id)); }}>Close Tabs to the Right</button>
      )}
    </div>
  );
})()}
```

`closeSingleTab(id)` uses the existing `closeTab` path so the single-close dirty prompt stays the same per-tab confirm (matches × button). The bulk ops use `closeManyTabs` (consolidated prompt).

Position correction — after render, if the menu's right edge would exceed `window.innerWidth - 8`, shift `left` inward. Same for bottom edge. Use a `useLayoutEffect` on the menu element.

### 5. CSS additions — `src/App.css`

```css
.tab-context-menu {
  min-width: 180px;
}
.request-menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--border-primary);
}
```

Reuses `.request-menu` styling as-is. The class combination `request-menu tab-context-menu` gets the base drop + divider styling.

## Acceptance Criteria

### AC1 — Right-click opens menu
Right-clicking any `.open-tab` opens `[data-testid="tab-context-menu"]` at the cursor position. Preventing default browser menu.

### AC2 — Escape closes menu
Pressing Escape while the menu is open dismisses it.

### AC3 — Outside click closes menu
Clicking anywhere outside the menu (including on another tab) dismisses it.

### AC4 — Close item
Clicking `[data-testid="tab-menu-close"]` closes the clicked tab. If the clicked tab was active, focus moves to the tab immediately to its right; if there is no right neighbor, focus moves to the left neighbor. This rule applies even when the clicked tab isn't active: the active tab is preserved if still present.

### AC5 — Close Other Tabs
Keeps only the clicked tab. If any of the closed tabs were dirty and `skipCloseConfirm` is false, shows a consolidated confirm prompt listing those dirty tabs by name. Cancel aborts the whole operation; no tabs close. Hidden when `openTabs.length === 1`.

### AC6 — Close Unmodified Tabs
Closes every tab that is NOT dirty and is NOT the clicked tab. Clicked tab stays regardless of its own dirty state. Other dirty tabs stay. No confirm prompt ever (nothing dirty is being closed). Hidden when there are no other clean tabs.

### AC7 — Close Tabs to the Left
Closes every tab positioned left of the clicked tab in `openTabs`. Same dirty-prompt rules as AC5. Hidden when clicked tab is index 0.

### AC8 — Close Tabs to the Right
Closes every tab positioned right of the clicked tab. Same dirty-prompt rules as AC5. Hidden when clicked tab is the last index.

### AC9 — Dirty consolidated prompt
When a bulk op would close N dirty tabs (N ≥ 1), the ConfirmModal opens with:
- Title: `Unsaved Changes` (or the op's `confirmTitle` override for Close Other Tabs)
- Message: `You have unsaved changes in N tab(s). Close anyway?`
- A visible `[data-testid="confirm-list"]` `<ul>` listing each dirty tab's display name
- Cancel aborts the whole bulk op.

### AC10 — skipCloseConfirm bypass
If `userConfig.skipCloseConfirm` is true, all bulk ops close immediately without any prompt. Matches the × button behavior.

### AC11 — Menu does not clip off-screen
On a right-click near the viewport's right or bottom edge, the menu repositions so it stays fully visible (within an 8px safety margin).

### AC12 — Regression — × button unchanged
Clicking the × button continues to work as before: per-tab dirty prompt via ConfirmModal, temp-tab flow unchanged, activation rule reuses the new `computeNextActiveTabId` (right-neighbor-first). Existing × behavior tests still pass.

### AC13 — Regression — all existing ConfirmModal callers unchanged
ConfirmModal without `listItems` renders exactly as before (no empty `<ul>`, no layout shift). Grep all `confirm({...})` callers — none specify `listItems`.

## Test Plan

### E2E — `e2e/tab-context-menu.spec.ts` (new file)

1. **tab-menu-opens-on-right-click** — Open 3 requests in tabs. Right-click the middle tab. Assert `[data-testid="tab-context-menu"]` visible. Press Escape. Assert menu gone.
2. **tab-menu-close** — From a 3-tab setup with the rightmost active, right-click the active tab, click `[data-testid="tab-menu-close"]`. Assert 2 tabs remain and the tab previously to the left of the closed one is now active.
3. **tab-menu-close-others** — Open 3 tabs. Right-click the middle. Click `tab-menu-close-others`. Assert only the middle tab remains.
4. **tab-menu-close-others-hidden-for-single-tab** — With only 1 tab open, right-click it. Assert `tab-menu-close-others` NOT visible.
5. **tab-menu-close-left-right** — Open 3 tabs. Right-click the middle. Verify both `tab-menu-close-left` and `tab-menu-close-right` visible. Click `close-left`; assert 2 rightmost remain. Re-open 3 tabs, click `close-right`; assert 2 leftmost remain.
6. **tab-menu-close-left-hidden-for-leftmost** — Right-click leftmost tab. Assert `tab-menu-close-left` NOT visible. Same for right on rightmost.
7. **tab-menu-close-unmodified-keeps-dirty** — Open 3 tabs, modify the middle one (edit request URL) so it becomes dirty. Right-click the leftmost (clean) tab. Click `tab-menu-close-unmodified`. Assert the leftmost + middle (dirty) remain; the rightmost (clean) is gone.
8. **tab-menu-close-unmodified-hidden-when-no-clean-others** — Open 2 tabs, modify the non-clicked one so both-but-clicked are dirty... actually set it up so every non-clicked tab is dirty → clicked is clean. Verify `tab-menu-close-unmodified` is hidden.
9. **tab-menu-bulk-dirty-confirm** — Open 3 tabs, make 2 of them dirty. Right-click the clean tab, click `close-others`. Assert confirm modal opens with `[data-testid="confirm-list"]` showing both dirty tab names. Cancel → all 3 tabs still open. Re-do and Confirm → only the clicked tab remains.

### Regression
- `e2e/request.spec.ts` — × button flow still works (request-delete test).
- Any existing confirm-modal-based test — must still pass with the new optional `listItems` prop.
