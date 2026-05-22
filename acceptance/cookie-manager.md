# Acceptance Spec: Cookie Manager Dialog + Auth-tab Entry Point (GH-48)

## Goal
A Cookie Manager dialog for viewing and editing the whole cookie jar, opened from a "Cookies" button in the Request editor's Auth tab. All mutations go through the existing Zustand `cookieStore` CRUD and persist immediately to `localStorage`.

## Background / Existing API (do NOT change)
- Store: `src/stores/cookieStore.js` — default export `useCookieStore` (Zustand).
  - State: `jar` — shape `{ [domain: string]: Cookie[] }`. Reactive; subscribe with `useCookieStore(s => s.jar)`.
  - `getDomains(): string[]` → `Object.keys(jar)`.
  - `upsert(domain, cookie)` — adds or replaces a cookie matched by `name` + `path`; persists.
  - `removeCookie(domain, name)` — removes ALL cookies with that name in the domain; deletes the domain key if it becomes empty; persists.
  - `removeDomain(domain)` — deletes the whole domain entry; persists.
- Cookie object shape (from `src/utils/cookies.js`):
  ```js
  { name, value, path: '/', expires: null, secure: false, httpOnly: false, sameSite: 'Lax', domain: null }
  ```
- Confirm dialog: `useConfirm()` from `src/components/ConfirmModal.jsx` (Promise-based, supports `variant: 'danger'`).
- Modal/style references: existing `.prompt-overlay`/`.prompt-modal` patterns; button classes `.btn-primary`, `.btn-secondary`, `.btn-icon`. New styles live in `src/styles/cookie-manager.css`, imported in `src/App.jsx`.

## Interface Contract

### Component: `src/components/CookieManagerModal.jsx`
Default export `CookieManagerModal`.

Props:
| prop | type | meaning |
| --- | --- | --- |
| `isOpen` | boolean | when false, render nothing (`return null`) |
| `onClose` | () => void | called on backdrop click, X button, or Escape |

Behavior:
- Subscribes to the live jar via `useCookieStore`.
- Renders nothing when `isOpen` is false.

### Integration: `src/components/RequestEditor.jsx`
- In the **Auth tab** content (the `.auth-editor` block), after the auth-type selector, render a **"Cookies" button** (`data-testid="open-cookie-manager"`).
- Clicking it sets local state `showCookieManager = true`, which renders `<CookieManagerModal isOpen={showCookieManager} onClose={() => setShowCookieManager(false)} />`.

### Pure helpers: `src/components/cookieManagerUtils.js` (new)
The component MUST import these from this module so they can be unit-tested in isolation (no `@testing-library` is available in this repo — component DOM testing is covered by E2E, pure logic by Vitest):

```js
// Case-insensitive substring filter of domain names.
// domains: string[], query: string -> string[]
export function filterDomains(domains, query)
//  - empty/whitespace query returns all domains unchanged (same order)
//  - otherwise returns domains whose lowercased name includes the lowercased trimmed query

// Build a well-formed cookie object for manual creation.
// name: string, value: string -> Cookie
export function makeCookie(name, value)
//  - returns { name, value, path: '/', expires: null, secure: false, httpOnly: false, sameSite: 'Lax', domain: null }
//  - name/value are used as-is (trimming is the caller's responsibility)
```

### Styles: `src/styles/cookie-manager.css`
- Imported in `src/App.jsx` alongside the other `./styles/*.css` imports.
- Use existing CSS variables (`--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--radius-*`, `--space-*`). Support light/dark via the variables (no hardcoded colors). Match the polish of existing modals.

## Functional Requirements & data-testid contract

The component MUST expose these `data-testid` attributes (E2E + unit selectors depend on them exactly):

| testid | element |
| --- | --- |
| `cookie-manager-modal` | the dialog container (only present when open) |
| `cookie-manager-overlay` | the backdrop overlay |
| `cookie-manager-close` | the X / close button |
| `cookie-search` | the search `<input>` |
| `cookie-add-domain` | the "Add domain" button |
| `cookie-domain-item` | each domain row (one per visible domain) |
| `cookie-domain-name` | the domain-name text element within a row |
| `cookie-remove-domain` | per-domain remove button |
| `cookie-tag` | each cookie-name tag/chip within a domain |
| `cookie-add-cookie` | per-domain "add cookie" button |
| `cookie-remove-cookie` | per-tag remove button |
| `cookie-value-editor` | the textarea shown when a tag is clicked |
| `cookie-value-save` | save button in the value editor |
| `cookie-value-cancel` | cancel button in the value editor |
| `cookie-empty` | empty-state element (jar empty OR no search matches) |

### AC1 — Entry point
- The Auth tab shows a "Cookies" button (`open-cookie-manager`). Clicking it opens the dialog (`cookie-manager-modal` becomes visible).

### AC2 — Listing
- Each domain in the jar renders as a `cookie-domain-item`, vertically stacked, showing `cookie-domain-name`.
- Within each domain, every cookie renders as a horizontal `cookie-tag` showing the cookie **name**.

### AC3 — Edit value
- Clicking a `cookie-tag` reveals a `cookie-value-editor` textarea pre-filled with that cookie's current value.
- `cookie-value-save` calls `upsert(domain, { ...cookie, value: newValue })` (preserving name/path/other attrs), persisting the change, and closes the editor.
- `cookie-value-cancel` discards changes and closes the editor without mutating.

### AC4 — Add cookie
- `cookie-add-cookie` lets the user enter a new cookie **name** and **value** for that domain (via prompt(s) or inline inputs) and calls `upsert(domain, newCookie)` with a well-formed cookie object (defaults: `path:'/'`, `expires:null`, `secure:false`, `httpOnly:false`, `sameSite:'Lax'`, `domain:null`). The new tag appears.

### AC5 — Remove cookie
- `cookie-remove-cookie` on a tag calls `removeCookie(domain, name)`; the tag disappears. (If it was the last cookie, the domain row disappears too, per store behavior.)

### AC6 — Remove domain
- `cookie-remove-domain` confirms (via `useConfirm`, danger variant) then calls `removeDomain(domain)`; the domain row disappears.

### AC7 — Add domain
- `cookie-add-domain` lets the user enter a new domain name. Creating it makes an empty domain row available so the user can then add cookies to it. (Implementation may hold a pending/empty domain in local state until the first cookie is added, since the store only persists domains that contain cookies — that is acceptable as long as the new domain row is visible and accepts an add-cookie action.)

### AC8 — Search
- Typing in `cookie-search` filters `cookie-domain-item`s live by domain-name substring (case-insensitive). Non-matching domains are hidden.

### AC9 — Empty states
- When the jar has no domains, `cookie-empty` is shown.
- When a search yields no matching domains, `cookie-empty` is shown.

### AC10 — Close
- Clicking `cookie-manager-overlay` (backdrop), `cookie-manager-close`, or pressing Escape closes the dialog (`onClose`).

## Testing

### Unit (Vitest, `src/components/cookieManagerUtils.test.js`)
Test the pure helpers from `src/components/cookieManagerUtils.js`:
- `filterDomains`: empty/whitespace query returns all; case-insensitive substring match; partial matches; no-match returns `[]`; order preserved.
- `makeCookie`: returns the exact default-filled cookie shape with given name/value.

(`@testing-library/react` is NOT installed — do not add component-DOM unit tests; the component behavior is covered by the Playwright E2E spec. Reset store + localStorage in `beforeEach` if touching the store.)

### E2E (Playwright, `e2e/cookie-manager.spec.ts`) — REAL backend, no mocks
- Open app, create/open a request, go to Auth tab, click `open-cookie-manager`.
- Add a domain, add a cookie, verify the tag appears; edit its value via the textarea and save; verify persisted (reopen modal / reload still shows it via localStorage jar).
- Remove cookie, remove domain.
- Type in search to filter; verify empty state when no match.
- Use the project's existing E2E helpers/readiness waits (see `e2e/cookies-tab.spec.ts`).

## Out of scope
- Editing cookie attributes other than value (path/expires/secure/etc.) — only value editing is required.
- Global (non-Auth-tab) entry points.
