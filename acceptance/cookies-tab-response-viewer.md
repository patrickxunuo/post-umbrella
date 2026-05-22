# Acceptance Spec: Cookies tab in Response viewer (GH-47)

Part of the Cookie Support epic (#43). Builds on cookie capture (GH-45). Surfaces the cookies a
response set in a dedicated **Cookies** tab in the Response viewer, next to **Headers** —
read-only (editing happens elsewhere in the Cookie Manager).

## Background — what already exists

- `src/utils/cookies.js` exposes pure helpers:
  - `parseSetCookie(headerValue)` → `{ name, value, path, expires, secure, httpOnly, sameSite,
    domain }` or `null`. `expires` is epoch **milliseconds** or `null` (session). `domain` is
    `null` when the `Set-Cookie` has no explicit `Domain`.
  - `extractSetCookies(result)` → `string[]` of raw `Set-Cookie` strings, normalized across
    transports (prefers `result.setCookies` from the Edge Function proxy, else reads `set-cookie`
    entries from `result.headers` for Tauri). Never throws, never mutates.
  - `getDomainFromUrl(url)` → lowercased hostname, `''` on parse failure.
- `ResponseViewer.jsx` renders `.response-tabs` with `body`/`headers` driven by `activeTab`. The
  response object reaching the viewer (`displayResponse`) is the `sendRequest` result spread with
  `{ ...result, resolvedUrl, scriptLogs, consoleLogs }`, so it carries `setCookies` and/or
  `Set-Cookie` header entries plus `resolvedUrl`. For Examples, `displayResponse =
  example.response_data` (usually no cookie data).
- `.response-headers` table styles live in `src/styles/response-viewer.css` — the styling reference.

## Module 1 — `src/utils/cookies.js`: `getResponseCookies(response)` → CookieRow[]

Pure. `extractSetCookies` → `parseSetCookie` each → skip nulls → build rows. `domain` =
parsed cookie domain when truthy, else `getDomainFromUrl(response?.resolvedUrl)`, else `''`
(never null). Order preserved. Never throws, never mutates, `[]` when no cookie data.

CookieRow (frozen): `{ name, value, domain:string, path, expires:number|null, secure:boolean,
httpOnly:boolean, sameSite:string }`.

## Module 2 — `ResponseViewer.jsx`: Cookies tab

- `responseCookies = useMemo(() => getResponseCookies(displayResponse), [displayResponse])`;
  `hasCookies = responseCookies.length > 0` — with the other derivations, before early returns.
- Tab button rendered **only when `hasCookies`**, after Headers: `data-testid="response-tab-cookies"`,
  active class, `onClick={() => setActiveTab('cookies')}`. Not in the DOM when no cookies.
- Fallback effect: `if (activeTab === 'cookies' && !hasCookies) setActiveTab('body')`.
- Content (`activeTab === 'cookies'`): `div.response-cookies[data-testid="response-cookies"]` →
  `<table>` columns Name, Value, Domain, Path, Expires, Secure, HttpOnly, SameSite; one
  `tr[data-testid="cookie-row"]` per cookie. Expires: `Session` when null, else `toLocaleString()`.
  Secure/HttpOnly: `Yes`/`—`.
- Styling mirrors `.response-headers` in `src/styles/response-viewer.css`, theme variables only.
- Body/Headers behavior unchanged; tab switching does not reset the response.

## Acceptance Criteria (from ticket)

- [ ] Cookies tab appears only when the current response set ≥1 cookie; hidden otherwise.
- [ ] Tab lists each cookie with name, value, and attributes.
- [ ] Switching tabs (Body / Headers / Cookies) works and preserves response state.
- [ ] Does not appear for saved Examples without cookie data.
- [ ] `data-testid` selectors added (`response-tab-cookies`, `response-cookies`, `cookie-row`).

## Tests

- Vitest (`npm run test:unit`, hard gate): `src/utils/cookies.test.js` `describe('getResponseCookies')`
  — null/`{}`/no-cookie → `[]`; proxy `setCookies`; Tauri header entries (mixed case); domain
  fallback; explicit Domain wins; expires passthrough/null; order preserved; missing resolvedUrl →
  `''`; no mutation; frozen shape.
- Playwright E2E (`npm run test:e2e`, real backend): `e2e/cookies-tab.spec.ts` — send via proxy to
  `https://httpbin.org/response-headers?Set-Cookie=...` → Cookies tab appears and lists the cookie;
  send `https://httpbin.org/get` → no Cookies tab.

## Interface Contract (frozen)

```js
// src/utils/cookies.js
export function getResponseCookies(response): CookieRow[]
//   domain: parsed cookie domain || getDomainFromUrl(response.resolvedUrl) || ''
//   never throws, never mutates, [] when no cookie data
// Selectors: response-tab-cookies (button, only when cookies present),
//            response-cookies (table), cookie-row (each row)
// Columns: Name, Value, Domain, Path, Expires, Secure, HttpOnly, SameSite
```
