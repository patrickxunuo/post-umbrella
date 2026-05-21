# Acceptance Spec: Capture Set-Cookie from Responses (GH-45)

Part of the Cookie Support epic (#43). Builds on the cookie jar storage system (GH-44).
Capture `Set-Cookie` response headers and store them in the jar, keyed by the request's domain.

## Background — what already exists (GH-44)

- `src/utils/cookies.js` — pure helpers: `parseSetCookie`, `getDomainFromUrl`, `cookiesForUrl`,
  `serializeCookieHeader`, `upsertCookie`, `removeCookie`, `removeDomain`.
- `src/stores/cookieStore.js` — zustand store, key `pu_cookie_jar`, exposes
  `getCookiesForUrl`, `setCookiesFromResponse`, `upsert`, `removeCookie`, `removeDomain`, `getDomains`.
- `parseSetCookie` already produces `expires` as epoch **milliseconds** (`null` = session cookie).
  `Max-Age=0`/negative or a past `Expires` yields an `expires` value `<= Date.now()`.

## Transport reality (verified, do not re-derive)

`data.sendRequest` (`src/data/supabase/proxy.js`) routes three ways:

1. **Edge Function proxy** (browser, remote URLs) — returns a JSON result object.
   Currently `headers` is built with `response.headers.forEach`, which **folds** multiple
   `Set-Cookie` into one comma-joined value. Must additionally expose them un-folded.
2. **Tauri desktop** (`src-tauri/src/lib.rs` `http_request`) — iterates `res.headers().iter()`,
   so multiple `set-cookie` already arrive as **separate** `['set-cookie', value]` entries in the
   result's `headers` array. **No Rust change required.**
3. **Browser direct** (local/private URLs, no Tauri) — uses `window.fetch`; `Set-Cookie` is a
   **forbidden response header** and is unreadable. No capture possible.

---

## Module 1 — `src/utils/cookies.js`: new pure helper

### `extractSetCookies(result)` → string[]

Pure function. Extracts the raw `Set-Cookie` header strings from a `sendRequest` result object,
normalizing across the three transports.

- If `result.setCookies` is an array → return it verbatim (Edge Function proxy path).
- Else if `result.headers` is an array → return the `value` of every entry whose `key`,
  compared case-insensitively, equals `set-cookie` (Tauri path — separate entries).
- Else → return `[]`.
- Never throws on missing/`null`/`undefined` `result`, `result.headers`, or entries lacking `key`.
- Does not mutate its input.
- When `result.setCookies` is present it takes precedence; `headers` is **not** also scanned
  (avoids double-counting the proxy's folded display copy).

Examples:
- `extractSetCookies({ setCookies: ['a=1', 'b=2'] })` → `['a=1', 'b=2']`
- `extractSetCookies({ headers: [['set-cookie','a=1']] })` → not applicable (headers are
  `{key,value}` objects in the result, see below).
- `extractSetCookies({ headers: [{key:'Set-Cookie', value:'a=1; Path=/'}, {key:'Content-Type', value:'text/html'}, {key:'set-cookie', value:'b=2'}] })`
  → `['a=1; Path=/', 'b=2']`
- `extractSetCookies({ headers: [{key:'Content-Type', value:'text/html'}] })` → `[]`
- `extractSetCookies({})` → `[]`
- `extractSetCookies(null)` → `[]`
- `extractSetCookies({ setCookies: ['x=1'], headers: [{key:'set-cookie', value:'y=2'}] })` → `['x=1']` (setCookies wins)

> Note: in the `sendRequest` result, `headers` is an array of `{ key, value }` objects (both the
> proxy and Tauri paths map to that shape). The helper reads `entry.key` / `entry.value`.

---

## Module 2 — `src/stores/cookieStore.js`: expiry-aware capture

### `setCookiesFromResponse(url, setCookieValues)` — extend existing behavior

Existing behavior: parse each raw `Set-Cookie` string, skip nulls, compute the storage domain
(explicit `Domain` attribute when the URL host domain-matches it, else `getDomainFromUrl(url)`),
`upsertCookie`, persist once, update state.

**New requirement:** if a parsed cookie is **already expired** — `cookie.expires != null &&
cookie.expires <= Date.now()` — it must **remove** any matching cookie (same `name`) under the
computed domain instead of inserting it. This is how servers delete cookies (`Max-Age=0` or a past
`Expires`).

- A single call may mix live and expired cookies — live ones are upserted, expired ones removed.
- Removal uses the same domain resolution as insertion.
- Persist once at the end (single localStorage write) and update `jar` state once.
- Removing a cookie that isn't present is a no-op (no throw).
- Existing tests for storing live cookies must keep passing unchanged.

---

## Module 3 — `supabase/functions/proxy/index.ts`: expose un-folded Set-Cookie

In the success path, after building the existing `responseHeaders` array (keep it — it backs the
Response viewer display, including the folded Set-Cookie entry), also collect the un-folded values:

```ts
const setCookies =
  typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
```

Add `setCookies` to the returned `result` object. The existing `headers` array is unchanged.
The timeout/error response shapes need not include `setCookies` (treated as none).

---

## Module 4 — `src/data/supabase/proxy.js`: document the browser limitation

In `sendDirectRequest`'s **browser fetch path** (the `window.fetch` branch, not the Tauri branch),
where `responseHeaders` is built from `response.headers.forEach`, add a code comment noting that
`Set-Cookie` is a forbidden response header that `fetch` cannot read, so no cookies are captured on
the direct browser path. No behavior change.

---

## Module 5 — execution hooks: wire capture

Both hooks already compute `resolvedUrl` (the actual URL the request was sent to) and
`const result = await data.sendRequest(...)`. After the result returns and the post-abort guard,
capture cookies:

```js
import useCookieStore from '../stores/cookieStore';
import { extractSetCookies } from '../utils/cookies.js';
// ...
const setCookieValues = extractSetCookies(result);
if (setCookieValues.length > 0) {
  useCookieStore.getState().setCookiesFromResponse(resolvedUrl, setCookieValues);
}
```

### `src/hooks/useResponseExecution.js`
- Insert after the `if (controller.signal.aborted) return;` guard that follows `data.sendRequest`,
  before post-scripts run. Use `resolvedUrl`.

### `src/hooks/useWorkflowExecution.js`
- Insert after the `if (controller.signal.aborted) break;` guard that follows `data.sendRequest`,
  before post-scripts run, inside the per-step loop. Use the step's `resolvedUrl`.

- Capture must not throw into the request flow; it is best-effort (an empty/parse-failure list is a
  silent no-op, already handled by `extractSetCookies` + `setCookiesFromResponse`).

---

## Acceptance Criteria (from ticket)

- [ ] A response with one or more `Set-Cookie` headers (via proxy or desktop) populates the jar
      under the correct domain.
- [ ] Multiple `Set-Cookie` headers are captured as separate cookies (not folded).
- [ ] Cookie attributes (path, expires, secure, httponly, samesite) are parsed and stored
      (delegated to existing `parseSetCookie`).
- [ ] A `Set-Cookie` with `Max-Age=0` / past expiry removes the matching cookie from the jar.
- [ ] Existing header display in the Response viewer is unchanged (`headers` array untouched).

## Test Framework

Vitest (`npm run test:unit` → `vitest run`), jsdom env.
- `src/utils/cookies.test.js` — pure tests for `extractSetCookies` (proxy field, Tauri header
  entries, browser/empty, precedence, null-safety). No DOM needed.
- `src/stores/cookieStore.test.js` — `setCookiesFromResponse` expiry-removal:
  seed a live cookie, then a `Max-Age=0` Set-Cookie for the same name → cookie gone from jar;
  mixed live+expired in one call; use `vi.useFakeTimers()` or past `Expires` for determinism.

## Interface Contract (frozen — both agents code to this)

```js
// src/utils/cookies.js
export function extractSetCookies(result): string[]   // never throws, never mutates

// src/stores/cookieStore.js  (signature unchanged; behavior extended)
setCookiesFromResponse(url: string, setCookieValues: string[]): void
//   live cookie  -> upsert under resolved domain
//   expired cookie (expires != null && expires <= Date.now()) -> remove matching name under domain
```
