# Acceptance Spec: Cookie Header Injection (GH-46)

## Goal
When sending a request, look up cookies in the jar matching the target domain and
attach them as a `Cookie` header. Applies to single-request execution and workflow steps.

## Interface Contract

### New pure helper in `src/utils/cookies.js`

```js
/**
 * Build a merged Cookie header value from jar cookies and an optional
 * manually-specified Cookie header value. On name collision, the manual
 * value wins. Manual cookies keep their original order and precede jar-only
 * cookies. Output is serialized as `name=value; name2=value2`.
 *
 * @param {Array<{name: string, value: string}>} jarCookies - cookies from the jar (already filtered)
 * @param {string} [manualCookieValue] - the user's existing Cookie header value, if any
 * @returns {string} merged Cookie header value, or '' if there is nothing to send
 */
export function buildCookieHeader(jarCookies, manualCookieValue) { ... }
```

Behavior:
- Parse `manualCookieValue` (e.g. `"a=1; b=2"`) into ordered `{name, value}` pairs.
  Split on `;`, each segment split on the FIRST `=`. Trim names. Ignore empty segments
  and segments with an empty name.
- Start the result with the manual pairs (preserving their order and values verbatim).
- Append each jar cookie whose `name` is NOT already present among the manual names
  (case-sensitive name match — cookie names are case-sensitive per RFC 6265).
- Serialize as `name=value` joined by `; `.
- If both inputs are empty/absent, return `''`.
- A falsy/empty `manualCookieValue` is treated as no manual cookies.

### Integration in `src/hooks/useResponseExecution.js` and `src/hooks/useWorkflowExecution.js`

After `resolvedUrl` and `resolvedHeaders` are built, and BEFORE the request payload is
constructed:

1. `const jarCookies = useCookieStore.getState().getCookiesForUrl(resolvedUrl);`
2. If `jarCookies.length > 0`:
   - Find an existing enabled Cookie header (case-insensitive key match, `enabled !== false`).
   - `const merged = buildCookieHeader(jarCookies, existingCookieHeader?.value);`
   - If a Cookie header exists, set its `value` to `merged`; otherwise push
     `{ key: 'Cookie', value: merged, enabled: true }`.
3. If `jarCookies.length === 0`, do nothing (no Cookie header added by us).
4. Add a code comment: the browser-direct fetch path forbids the `Cookie` header and the
   browser silently drops it; the proxy and Tauri paths forward it. No error is raised.

## Acceptance Criteria

1. A request to a domain with stored cookies sends a `Cookie` header containing them.
2. No `Cookie` header is added when the jar has no match for the domain.
3. A manual `Cookie` header in the Headers tab is preserved and merged — manual wins on conflict.
4. Expired cookies are not sent (handled by `getCookiesForUrl` filtering; verify no expired leak).
5. Works for both single-request execution (`useResponseExecution`) and workflow steps (`useWorkflowExecution`).

## Test Direction
- Unit-test `buildCookieHeader` thoroughly (all 5 criteria, plus edge cases: empty jar,
  empty manual, collisions, ordering, whitespace in manual value, manual value with no `=`).
- Optionally test the hook-level merge logic if practical; the pure helper is the core unit.
