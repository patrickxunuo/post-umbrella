# Acceptance Spec: Caret-Aware Path-Variable Colon Sanitization (Issue #40)

## Problem

After #38 shipped path variables, `sanitizeUrlForPathVars` (in `src/utils/substituteVariables.js`) strips any `:` whose next character is in the RFC 3986 reserved set, on every keystroke. This was meant to enforce the rule from #38: "if the user types `:` immediately followed by `/` or `?`, drop the colon — no empty variable."

The rule was implemented purely by looking at neighboring characters in the string, with no awareness of where the user is typing. That works when the user is appending to the end of the URL (the typical case `:` is followed by `/` only when the user just typed the `/` after the `:`). It breaks when the user is **inserting `:` to the left of an already-existing reserved char** — the natural editing flow when changing a literal segment to a path variable.

### Reproduction

1. Request URL: `/something/123/detail`
2. Select `123`, delete. URL is `/something//detail`, caret between the two slashes.
3. Type `:`.

**Expected:** `/something/:/detail`, caret right after `:`. Continuing to type `id` produces `/something/:id/detail` and an `id` row in Path Variables.

**Actual:** The `:` is stripped on the same keystroke. URL stays `/something//detail`. The user has no way to insert a `:` here — they must delete `/detail`, type `:id`, then retype `/detail`.

### Root cause

`src/utils/substituteVariables.js:130-146`:

```js
export function sanitizeUrlForPathVars(url) {
  if (!url) return url;
  const { pathStart, pathEnd } = computePathRange(url);
  let result = '';
  for (let i = 0; i < url.length; i++) {
    const ch = url[i];
    if (ch === ':' && i >= pathStart && i < pathEnd) {
      const next = url[i + 1];
      if (next !== undefined && PATH_VAR_RESERVED.has(next) && next !== ':') {
        continue;        // ← strips the colon
      }
    }
    result += ch;
  }
  return result;
}
```

Called from `src/components/RequestEditor.jsx:225` (`handleUrlChange`) on every URL onChange. No notion of caret position, so it can't tell "user just typed `/` after `:`" apart from "user just inserted `:` before existing `/`".

## Solution

Make `sanitizeUrlForPathVars` caret-aware. Strip a `:` followed by a reserved char **only when the caret sits immediately past the reserved char** — i.e. the user just typed the reserved char right after the colon. Preserve the colon when the caret sits between the colon and the reserved char (the user just inserted `:` to the left of existing content) or when caret position is unknown.

Caret position is the natural disambiguator because it captures the user's intent without any additional state:

| Scenario | Before | After typing | Caret idx | Colon idx | Strip? |
|---|---|---|---|---|---|
| Type `:` then `/` at end of `/users/` | `/users/:` | `/users/:/` | 9 (end) | 7 | **yes** — caret is at colonIdx + 2 |
| Insert `:` between two `/`s of `/a//b` (caret at 2) | `/a//b` | `/a/:/b` | 4 | 3 | **no** — caret is at colonIdx + 1 |
| Programmatic / unknown caret | n/a | n/a | undefined | n | **no** — preserve (defer cleanup) |

This matches user intent and leaves `extractPathVarTokens` unchanged: empty `:`-tokens (no name char between `:` and the next reserved) never produce a row, so a transient `:/` in the middle of the URL is harmless to data.

## Scope

Single-feature bugfix. No DB migration, no new component, no UI changes.

Edit only:
- Modified: `src/utils/substituteVariables.js` (signature + body of `sanitizeUrlForPathVars`)
- Modified: `src/components/RequestEditor.jsx` (`handleUrlChange` signature + URL `onChange` wiring)
- Modified: `e2e/path-variables.spec.ts` (add new test for the bug; existing tests must continue to pass without modification)

No new dependencies.

Out of scope:
- Touching `extractPathVarTokens`, `reconcilePathVariables`, `substituteUrl`, or any of the data-layer / hooks code from #38.
- Changing the `PATH_VAR_RESERVED` set.
- Sanitizing on blur or save (we considered "Option B" — defer cleanup to blur/save — but rejected it because it would change behavior of multiple existing tests for marginal benefit).
- The other `EnvVariableInput` callsites (params value, header value, auth token, path-var value cells) — none of them sanitize today, none gain it.
- cURL paste flow (`handleUrlPaste`) — already bypasses sanitize via direct `setUrl`, no change.

---

## Interface Contract

### `sanitizeUrlForPathVars(url, caretPos?)`

**File:** `src/utils/substituteVariables.js`

**New signature:**

```js
/**
 * Strip stray `:` followed immediately by a reserved char (or a non-name char).
 * Caret-aware: a colon at index `c` is stripped only if `caretPos === c + 2`
 * — i.e. the caret sits immediately past the reserved char, meaning the user
 * just typed the reserved char right after typing the colon. When caretPos is
 * undefined or any other value, the colon is preserved.
 *
 * Trailing `:` at end-of-string is preserved (user may still be typing).
 * `:` inside the host portion (scheme://host:port) is preserved.
 *
 * @param {string} url
 * @param {number} [caretPos] — current input caret position (selectionStart).
 *   Pass undefined for non-keystroke calls (programmatic, paste of structured data).
 * @returns {string}
 */
export function sanitizeUrlForPathVars(url, caretPos)
```

**Behavior rules:**
1. If `url` is falsy → return as-is.
2. Compute path range via existing `computePathRange` (unchanged).
3. Iterate characters. For each `:` inside the path range:
   - Let `next = url[i + 1]`.
   - If `next` is undefined → keep the `:` (trailing colon).
   - If `next` is `:` → keep (chained colons are not stripped — same as today).
   - If `next` is in `PATH_VAR_RESERVED` AND `caretPos === i + 2` → **strip** the `:`.
   - Otherwise → keep.
4. All other characters copied verbatim.

The `caretPos === i + 2` check works for all colons in the URL — but in practice the user only edits one location at a time, so at most one colon will satisfy the equality on any given keystroke.

### `RequestEditor.handleUrlChange(rawUrl, caretPos?)`

**File:** `src/components/RequestEditor.jsx`

**New signature** (caretPos optional for backward safety, but in practice always provided from the URL `onChange`):

```js
const handleUrlChange = (rawUrl, caretPos) => {
  const newUrl = sanitizeUrlForPathVars(rawUrl, caretPos);
  // ...rest of the function unchanged
};
```

**Wiring change** (line 500):

```jsx
<EnvVariableInput
  className="url-input"
  // ...
  onChange={(e) => handleUrlChange(e.target.value, e.target.selectionStart)}
  // ...
/>
```

`e.target` is the underlying `<input>` element (forwarded by `EnvVariableInput.handleInputChange`), so `selectionStart` is available and reflects the caret position right after React applies the input. Standard browser behavior — no special handling needed.

---

## Acceptance Criteria

### AC1 — Inserting `:` before existing `/` succeeds (the bug fix)
Given URL `/something//detail` with caret between the two slashes (position 11),
when user types `:`,
then URL becomes `/something/:/detail` (the `:` stays),
and caret is at position 12 (right after the inserted `:`).

### AC2 — Continuing to type a name produces a Path Variables row
Following AC1, when user types `i` then `d`,
then URL becomes `/something/:id/detail`,
and a Path Variables row with key `id` appears in the Params tab.

### AC3 — Append-then-add-slash still strips (regression guard)
Given URL `/users/` with caret at end,
when user types `:` then `/`,
then URL becomes `/users//` (the `:` is stripped),
and no Path Variables row is created.
This is the existing `f2-reserved-char-strips-colon` test — must continue to pass without changes.

### AC4 — Trailing `:` still preserved (regression guard)
Given URL `/users/` with caret at end,
when user types `:`,
then URL becomes `/users/:` (preserved, no row),
and continuing with `id` produces `/users/:id` and an `id` row.
This is the existing `f2-trailing-colon-preserved` test — must continue to pass without changes.

### AC5 — Backspacing the variable name still removes the row
Given URL `/users/:id`,
when user backspaces 3 times to remove `:id`,
then URL becomes `/users/` and the path variables section is hidden.
This is the existing `f2-removing-name-removes-row` test — must continue to pass without changes.

### AC6 — `:` in `scheme://host:port` untouched
URL `https://example.com:8080/users/:id` parses correctly: only one path-var row (`id`), the `:8080` colon is left alone. Existing behavior — must continue to pass.

### AC7 — Programmatic / undefined caret preserves colons
`sanitizeUrlForPathVars('/a/:/b')` (no second arg) returns `/a/:/b` unchanged. Callers that don't have caret context (none today, but future-proof) get a non-destructive default.

### AC8 — Live request and Copy as cURL both materialize correctly after the fix
Given URL `/items/:id/detail`, path-var `id = 42`,
the actual HTTP request goes to `/items/42/detail`,
and the Copy as cURL preview shows `/items/42/detail`.
Already covered by `f2-curl-preview-matches` and `f1-pure-substitute-url`. The fix touches only `sanitizeUrlForPathVars`, not `substituteUrl`, so these should be unaffected — but verify in the test pass.

---

## Test Plan

### E2E (Playwright) — new test in `e2e/path-variables.spec.ts`

Add **one** new test under the `describe('Path Variables — F2 URL Parsing')` block (after `f2-removing-name-removes-row`):

```ts
// AC-F2.x — Bug #40 regression
test('f2-insert-colon-between-segments', async ({ page }) => {
  await createTestRequest(page, uniqueName('PV F2 InsertBetween'));

  const urlInput = page.locator('.url-input');
  await urlInput.click();
  // Start with a literal segment between two slashes, like a user editing an existing URL
  await urlInput.fill('https://example.com/something/123/detail');

  // Select the literal segment "123" and delete it
  // Range positions: '/something/' ends at index 31; '123' is 31..34
  await urlInput.evaluate((el: HTMLInputElement) => {
    el.focus();
    el.setSelectionRange(31, 34);
  });
  await page.keyboard.press('Delete');
  await expect(urlInput).toHaveValue('https://example.com/something//detail');

  // Now caret sits between the two slashes — type ':id'
  await urlInput.pressSequentially(':id', { delay: 30 });

  await expect(urlInput).toHaveValue('https://example.com/something/:id/detail');

  await openParamsTab(page);
  const section = page.locator('[data-testid="path-variables-section"]');
  await expect(section).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="path-variable-row-id"]')).toBeVisible();
});
```

Existing 22 path-variables tests must all continue to pass with **zero modifications**.

### Manual smoke (after E2E green)
1. Open a request with URL `/users/123`. Click between `/` and `1`, delete `123`, type `:userId`. Confirm row appears, value field is editable.
2. Click on the `:userId` token in the URL — confirm the `VariablePopover` opens (existing F3 behavior).
3. Set the path-var value to `42`, click "Copy as cURL", confirm the curl text contains `/users/42`.

### Unit tests
The repo has no unit-test runner configured (per `memory-bank/techContext.md`: "Unit/API tests: None configured"). The existing path-variables util has zero unit-test files. Per project convention, the E2E test above is the contract test for this fix. **No new unit-test infrastructure is added by this bugfix.**

If the agent team disagrees and wants a focused vitest harness for `sanitizeUrlForPathVars`, escalate before adding a test runner — that's a project-wide decision out of scope for this bugfix.

---

## Risks / Notes

- **Synthetic React event quirk:** `EnvVariableInput.insertVariable` (line 161-167) creates a synthetic event `{ target: { value: newValue } }` without a real input element, so `e.target.selectionStart` would be `undefined`. That codepath only runs on autocomplete-pick of a `{{var}}` from the suggestion dropdown — not relevant to typing `:`. The fallback "preserve when caretPos undefined" handles it safely (no spurious strip during autocomplete insertion).
- **No persistence change.** The `path_variables` JSONB column from #38 is unchanged. Reconciliation continues to drop empty-name tokens via `extractPathVarTokens`.
- **No new translations / no i18n surface.**
