# Acceptance Spec: Cookies tab in Response viewer (GH-47)

Part of the Cookie Support epic (#43). Builds on cookie capture (GH-45). Surfaces the cookies a
response set in a dedicated **Cookies** tab in the Response viewer, next to **Headers** —
read-only (editing happens elsewhere in the Cookie Manager).

## Background — what already exists

- `src/utils/cookies.js` exposes pure helpers:
  - `parseSetCookie(headerValue)` → cookie object `{ name, value, path, expires, secure, httpOnly,
    sameSite, domain }` or `null`. `expires` is epoch **milliseconds** or `null` (session cookie).
    `domain` is `null` when the `Set-Cookie` has no explicit `Domain` attribute.
  - `extractSetCookies(result)` → `string[]` of raw `Set-Cookie` header strings, normalized across
    transports: prefers `result.setCookies` (Edge Function proxy), else reads `result.headers`
    entries whose `key` is `set-cookie` (Tauri). Never throws, never mutates.
  - `getDomainFromUrl(url)` → lowercased hostname, or `''` on parse failure.
- `src/components/ResponseViewer.jsx` renders a `.response-tabs` tab bar with `body` / `headers`
  driven by `activeTab` state. The response object reaching the viewer (`displayResponse`) is the
  `sendRequest` result spread with extra fields: `{ ...result, resolvedUrl, scriptLogs,
  consoleLogs }`. So it carries `setCookies` (proxy path) and/or `Set-Cookie` entries in `headers`
  (Tauri path), plus `resolvedUrl`.
- For saved Examples, `displayResponse = example.response_data` — typically has no cookie data.
- `.response-headers` table styles in `src/App.css` are the styling reference.

---

## Module 1 — `src/utils/cookies.js`: new pure helper

### `getResponseCookies(response)` → CookieRow[]

Pure function. Derives display-ready cookie rows from a `sendRequest`-shaped response object.

Behavior:
1. `const raw = extractSetCookies(response)` — reuse, do not re-implement extraction.
2. For each raw string, `parseSetCookie(value)`; **skip** any that parse to `null`.
3. For each parsed cookie, produce a row:
   - `name`, `value`, `path`, `expires`, `secure`, `httpOnly`, `sameSite` — passed through from
     `parseSetCookie`.
   - `domain` — the parsed cookie's `domain` when truthy; otherwise fall back to
     `getDomainFromUrl(response.resolvedUrl)`. If neither yields a value, `domain` is `''`.
4. Returns the rows in the same order as the raw `Set-Cookie` values.

Contract:
- Never throws on `null` / `undefined` / `{}` / missing `headers` / missing `resolvedUrl`.
- Does not mutate its input.
- Returns `[]` when there is no cookie data.

CookieRow shape (frozen):
```js
{
  name: string,
  value: string,
  domain: string,        // never null — '' when unknown
  path: string,
  expires: number | null, // epoch ms, or null for session cookies
  secure: boolean,
  httpOnly: boolean,
  sameSite: string,       // 'Lax' | 'Strict' | 'None'
}
```

Examples:
- `getResponseCookies(null)` → `[]`
- `getResponseCookies({})` → `[]`
- `getResponseCookies({ headers: [{ key: 'Content-Type', value: 'text/html' }] })` → `[]`
- `getResponseCookies({ setCookies: ['sid=abc; Path=/; HttpOnly'], resolvedUrl: 'https://api.example.com/login' })`
  → `[{ name:'sid', value:'abc', domain:'api.example.com', path:'/', expires:null, secure:false, httpOnly:true, sameSite:'Lax' }]`
  (domain falls back to the resolvedUrl host because the cookie has no Domain attribute)
- `getResponseCookies({ setCookies: ['a=1; Domain=example.com; Secure; SameSite=None'], resolvedUrl: 'https://www.example.com/' })`
  → one row with `domain:'example.com'`, `secure:true`, `sameSite:'None'`
- Multiple cookies (proxy un-folded array) → one row each, order preserved.
- Tauri header entries: `getResponseCookies({ headers: [{key:'Set-Cookie', value:'a=1'}, {key:'set-cookie', value:'b=2'}], resolvedUrl:'http://h.test/' })`
  → two rows `a` and `b`, both `domain:'h.test'`.

---

## Module 2 — `src/components/ResponseViewer.jsx`: Cookies tab

1. Compute cookies once per response:
   ```js
   const responseCookies = useMemo(() => getResponseCookies(displayResponse), [displayResponse]);
   const hasCookies = responseCookies.length > 0;
   ```
   (Place with the other `useMemo` derivations, before early returns.)

2. **Tab button** — render a third tab button **only when `hasCookies`**, after the Headers button,
   inside `.response-tabs`:
   - text: `Cookies` (optionally with a count, e.g. `Cookies` — keep it simple, name + count is fine)
   - `data-testid="response-tab-cookies"`
   - `className={activeTab === 'cookies' ? 'active' : ''}`, `onClick={() => setActiveTab('cookies')}`
   - When `!hasCookies`, the button must not be in the DOM at all (hidden, not disabled).

3. **Fallback guard** — if the active tab is `cookies` but the current response has no cookies
   (e.g. a new response arrived), reset to `body`. Add an effect:
   ```js
   useEffect(() => {
     if (activeTab === 'cookies' && !hasCookies) setActiveTab('body');
   }, [activeTab, hasCookies]);
   ```

4. **Tab content** — when `activeTab === 'cookies'`, render a read-only table in the
   `.response-content` area (sibling to the existing `headers` block):
   - Wrapper `div` with `className="response-cookies"` and `data-testid="response-cookies"`.
   - A `<table>` with a header row and one body row per cookie. Columns, in order:
     `Name`, `Value`, `Domain`, `Path`, `Expires`, `Secure`, `HttpOnly`, `SameSite`.
   - Each data row keyed by index; give each row `data-testid="cookie-row"` so E2E can count rows.
   - `Expires`: render `Session` when `expires == null`; otherwise a human-readable date
     (e.g. `new Date(expires).toLocaleString()`).
   - `Secure` / `HttpOnly`: render a checkmark/`Yes` when true and an empty/`—` cell when false
     (consistent, accessible — text is fine).
   - The table must stay readable when there are no cookies for a column attribute (always show all
     columns).

5. Styling — reuse the `.response-headers` table look. Add `.response-cookies` table rules to
   `src/App.css` mirroring `.response-headers` (same border/padding/header styling, theme variables).
   Do not introduce hardcoded colors; use existing CSS variables.

6. The existing Body / Headers tabs and all other behavior must be unchanged. Switching between
   Body / Headers / Cookies preserves response state (no refetch, no reset of the response object).

---

## Acceptance Criteria (from ticket)

- [ ] Cookies tab appears only when the current response set ≥1 cookie; hidden otherwise.
- [ ] Tab lists each cookie with name, value, and attributes (Domain, Path, Expires, Secure,
      HttpOnly, SameSite).
- [ ] Switching tabs (Body / Headers / Cookies) works and preserves response state.
- [ ] Does not appear for saved Examples without cookie data.
- [ ] `data-testid` selectors added for E2E (`response-tab-cookies`, `response-cookies`,
      `cookie-row`).

## Test Framework

### Vitest (`npm run test:unit`) — hard gate
`src/utils/cookies.test.js` — add a `describe('getResponseCookies', ...)` block covering:
- null / `{}` / no-cookie response → `[]`
- proxy `setCookies` array path → one row per value, attributes parsed through
- Tauri `headers` `Set-Cookie` entries (mixed case key) → rows extracted
- domain fallback to `getDomainFromUrl(resolvedUrl)` when cookie has no `Domain`
- explicit `Domain` attribute wins over the URL host
- `expires` passes through as epoch ms / `null`
- order preserved across multiple cookies
- does not throw when `resolvedUrl` is missing (domain becomes `''`)
- does not mutate input

### Playwright E2E (`npm run test:e2e`) — real backend
`e2e/cookies-tab.spec.ts` — against the running app + real proxy (no mocking):
- Create a collection + request, set URL to an httpbin endpoint that returns a `Set-Cookie`
  response header without a redirect, e.g.
  `https://httpbin.org/response-headers?Set-Cookie=e2e_sid%3Dabc123%3B%20Path%3D/`.
  Send → response viewer appears, not loading → `response-tab-cookies` is visible → click it →
  `response-cookies` table visible and contains a `cookie-row` showing `e2e_sid` / `abc123`.
- Send a normal request with no Set-Cookie (e.g. `https://httpbin.org/get`) → `response-tab-cookies`
  is **not** visible.
- Follow existing spec conventions: `cleanupTestCollections(timestamp)` in `afterAll`, the
  `createTestRequest` collection/request setup helper pattern, generous timeouts for the proxy
  round-trip.

## Interface Contract (frozen — both agents code to this)

```js
// src/utils/cookies.js
export function getResponseCookies(response): CookieRow[]
//   reuses extractSetCookies + parseSetCookie + getDomainFromUrl
//   never throws, never mutates, [] when no cookie data
//   domain: parsed cookie domain || getDomainFromUrl(response.resolvedUrl) || ''

// ResponseViewer.jsx selectors:
//   tab button:   data-testid="response-tab-cookies"  (rendered only when cookies present)
//   tab content:  data-testid="response-cookies"      (read-only table)
//   each row:     data-testid="cookie-row"
//   columns (order): Name, Value, Domain, Path, Expires, Secure, HttpOnly, SameSite
```
