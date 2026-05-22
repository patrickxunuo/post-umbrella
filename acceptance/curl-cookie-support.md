# Acceptance Spec: cURL Cookie Support — Import + Export (GH-49)

## Goal
Round-trip cookies through cURL. On **export**, emit cookies as a single `-b "..."`
flag (never duplicated as `-H "Cookie: ..."`). On **import**, parse `-b`/`--cookie`
and a `Cookie:` header passed via `-H` into a single `Cookie` header on the imported
request.

Part of the Cookie Support epic (#43). Builds on the cookie jar (`src/utils/cookies.js`,
`src/stores/cookieStore.js`) and the send-path merge logic in `useResponseExecution.js`.

## Documented behavior decision (import target)
Imported cookies become a **single `Cookie` header** on the imported request — NOT jar
population. Rationale: `parseCurl` is a pure function returning a request object (no jar
side-effects); the result is observable in the Headers tab; and it round-trips cleanly
because the send/export paths already merge a manual `Cookie` header with jar cookies.

---

## Interface Contract

### 1. Export — `generateCurl` in `src/components/RequestEditor.jsx`

Add a trailing **optional** parameter `cookies`:

```js
/**
 * @param {...existing params...}
 * @param {Array<{name: string, value: string}>} [cookies] - jar cookies for the URL's domain
 */
export function generateCurl(method, url, headers, body, bodyType, formData, authType, authToken, cookies) { ... }
```

Behavior changes:
- In the existing `-H` header loop, **skip** any header whose key is `Cookie`
  (case-insensitive) — cookies are emitted via `-b` instead, never as `-H "Cookie: ..."`.
  (Authorization is already skipped for bearer auth; keep that.)
- After the auth header and before the body, compute the merged cookie string:
  ```js
  const manualCookie = enabledHeaders.find(h => h.key.toLowerCase() === 'cookie');
  const cookieStr = buildCookieHeader(cookies || [], manualCookie?.value);
  if (cookieStr) parts.push(`-b '${escapeShellArg(cookieStr)}'`);
  ```
  `buildCookieHeader` is imported from `../utils/cookies.js`. This mirrors the live send
  path exactly: manual Cookie header value wins on name collision; manual pairs precede
  jar-only cookies.
- If there are neither jar cookies nor a manual Cookie header, emit no `-b` (unchanged
  output for cookie-less requests).
- Backward compatibility: calling `generateCurl(...)` with no `cookies` arg and no manual
  Cookie header produces identical output to today.

### 2. Export caller — `src/components/CurlPanel.jsx`

The `curlPreview` `useMemo` must pass jar cookies for the resolved (substituted) URL:
- Subscribe to the jar reactively: `const jar = useCookieStore(s => s.jar);`
  (import `useCookieStore` from `../stores/cookieStore` and `cookiesForUrl` from
  `../utils/cookies.js`).
- Compute `const cookies = cookiesForUrl(jar, subUrl(req.url || ''));` and pass it as the
  9th argument to `generateCurl(...)`.
- Add `jar` to the `useMemo` dependency array so the preview updates when the jar changes.

### 3. Import — `parseCurl` in `src/components/ImportCurlModal.jsx`

The token-parsing loop must recognize cookie sources and merge them into ONE `Cookie`
header on `result.headers`:

- Add token handling for `-b` / `--cookie`: the next token is the cookie data
  (`name=value; name2=value2`). Accumulate it as a cookie source.
- In the existing `-H` / `--header` branch: if the parsed header key is `Cookie`
  (case-insensitive), do NOT push it as a normal header row — accumulate its value as a
  cookie source instead.
- After the loop, if any cookie data was collected, merge all sources into a single
  normalized `Cookie` header and push exactly one row:
  `{ key: 'Cookie', value: <merged>, enabled: true }`.
  - Merge semantics: parse each source into `name=value` pairs (split on `;`, then first
    `=`; trim names; ignore empty/nameless segments); combine in encounter order; on
    duplicate name, **first occurrence wins** (later duplicates ignored); serialize as
    `name=value` joined by `; `.
  - The merged Cookie header row must be added BEFORE the trailing empty
    `{ key:'', value:'', enabled:true }` editing row that `parseCurl` already appends.
- Non-cookie headers, body, method-defaulting, and form handling are unchanged.

> Implementation note: a tiny local merge helper is fine, or reuse
> `buildCookieHeader`/`serializeCookieHeader` from `../utils/cookies.js`. Keep names
> case-sensitive (RFC 6265).

---

## Acceptance Criteria

1. **Export emits `-b`**: `generateCurl(..., cookies)` for a request with jar cookies (or a
   manual `Cookie` header) includes a correct `-b 'name=value; name2=value2'` string.
2. **No duplication**: the exported cURL never contains both `-b` and `-H 'Cookie: ...'`
   for the same request. A manual `Cookie` header is folded into `-b`, not emitted as `-H`.
3. **Manual wins / merge order**: when both jar cookies and a manual `Cookie` header are
   present, the `-b` value has manual pairs first (verbatim), jar-only cookies appended,
   and manual wins on name collision.
4. **No cookies → no `-b`**: a request with no jar cookies and no manual Cookie header
   produces a cURL with no `-b` flag (identical to current output).
5. **Import `-b` / `--cookie`**: `parseCurl` of a command with `-b "a=1; b=2"` (or
   `--cookie "a=1; b=2"`) yields a single `Cookie` header `{key:'Cookie', value:'a=1; b=2'}`.
6. **Import `-H "Cookie: ..."`**: `parseCurl` of `-H "Cookie: a=1; b=2"` yields the same
   single `Cookie` header and no duplicate Cookie row.
7. **Import merge**: a command with both `-b "a=1"` and `-H "Cookie: b=2"` yields one
   `Cookie` header containing both (`a=1; b=2`), first-wins on name collision.
8. **Round-trip**: exporting a request with cookies and re-importing the result preserves
   the cookies (the imported `Cookie` header value matches the exported `-b` value).

---

## Test Direction
Create `src/components/curlCookies.test.js` (Vitest):
- **Export (`generateCurl`)**: criteria 1–4, plus edge cases — cookie value containing
  `=`, single-quote escaping in `-b`, jar-only with no manual header, manual-only with
  empty jar.
- **Import (`parseCurl`)**: criteria 5–7, plus — `--cookie` long form, a `Cookie:` header
  with mixed-case key (`cookie:`), whitespace tolerance, and that non-cookie headers/body
  are unaffected.
- **Round-trip (criterion 8)**: `parseCurl(<curl with -b>)` then feed the parsed Cookie
  header back through `generateCurl` and assert the `-b` value is preserved.
- Pure functions only — no React rendering required. Do not mock; call the real exports.
