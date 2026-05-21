# Acceptance Spec: Cookie Jar Storage System (GH-44)

Foundation for the Cookie Support epic (#43). A domain-keyed cookie jar with localStorage
persistence and a small CRUD/query API. **No UI in this issue.**

## Data Model

```js
// Cookie
{
  name: string,
  value: string,
  path: string = '/',
  expires: number | null = null,   // epoch MILLISECONDS, null = session cookie
  secure: boolean = false,
  httpOnly: boolean = false,
  sameSite: 'Lax' | 'Strict' | 'None' = 'Lax',
  domain: string | null = null,    // explicit Domain attribute (no leading dot), null = host-only
}

// Jar — domain-keyed map. The key is the registrable host the cookie was stored under.
// jar: { [domain: string]: Cookie[] }
```

## Module 1 — `src/utils/cookies.js` (pure functions, no DOM, no store)

All functions are pure: they never mutate inputs and never touch `localStorage` or globals.
The jar-mutating helpers return a NEW jar object (shallow-cloned at the touched domain).

### `getDomainFromUrl(url)` → string
- Returns the lowercased hostname of `url` (e.g. `'https://API.Example.com/v1?x=1'` → `'api.example.com'`).
- Strips port, path, query, hash.
- Returns `''` for input that has no parseable host (e.g. `''`, `'not a url'`).

### `parseSetCookie(headerValue)` → Cookie | null
- Parses a single `Set-Cookie` header value (e.g. `'sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600'`).
- First `name=value` pair is the cookie name/value. Value may be empty (`'foo='` → name `foo`, value `''`).
- Attributes are case-insensitive (`path`, `Path`, `PATH` all work).
- `Expires` → parsed to epoch ms via `Date.parse`; if both `Max-Age` and `Expires` present, `Max-Age` wins.
- `Max-Age` (seconds, integer) → `expires = Date.now() + maxAge*1000`. `Max-Age=0` or negative → already-expired (`expires` in the past).
- `Domain` attribute → stored on `domain` with any single leading dot stripped and lowercased (`.Example.com` → `example.com`).
- `Secure`, `HttpOnly` → boolean flags (presence = true).
- `SameSite=None|Lax|Strict` → normalized to canonical casing; missing → `'Lax'`.
- Missing `Path` → `'/'`.
- Returns `null` if there is no `name=value` pair at all (e.g. empty string, or only attributes).

### `cookiesForUrl(jar, url)` → Cookie[]
- Returns the cookies in `jar` that should be sent to `url`, after filtering:
  - **Domain match:** for a stored cookie with an explicit `domain`, it matches when the URL host
    equals that domain OR is a subdomain of it (`example.com` cookie matches `api.example.com`).
    For a host-only cookie (`domain == null`), the URL host must EXACTLY equal the jar key it is stored under.
  - **Path match:** the URL path must equal the cookie `path`, or start with `cookie.path` followed by `/`
    (default `'/'` matches everything). URLs with no path use `'/'`.
  - **Expiry:** cookies whose `expires` is non-null and `<= Date.now()` are dropped.
  - **Secure:** `secure` cookies are only returned for `https:` URLs.
- Iterates over all jar domains (not just the exact key) so a cookie stored under `example.com`
  is found for a request to `api.example.com`.
- Returned order is stable; duplicates by name are not expected within one domain.

### `serializeCookieHeader(cookies)` → string
- Joins cookies into a `Cookie:` header value: `'k1=v1; k2=v2'`.
- Empty array → `''`.

### `upsertCookie(jar, domain, cookie)` → jar
- Inserts or replaces (by `name` + `path`) the cookie under `domain`. Returns a new jar.
- `domain` is lowercased. Does not mutate the input jar or its arrays.

### `removeCookie(jar, domain, name)` → jar
- Removes all cookies with `name` under `domain`. Returns a new jar.
- If the domain ends up empty, the domain key is removed.
- No-op (returns an equivalent jar) if domain/name absent.

### `removeDomain(jar, domain)` → jar
- Removes the entire `domain` entry. Returns a new jar. No-op if absent.

## Module 2 — `src/stores/cookieStore.js` (zustand)

Follows the existing manual-localStorage pattern (`workbenchStore`, `consoleStore`) — NOT the
`persist` middleware. Read on init, write on every mutation.

- localStorage key: `pu_cookie_jar`. Value: `JSON.stringify(jar)`.
- Init: `jar: JSON.parse(localStorage.getItem('pu_cookie_jar') || '{}')` (guard against malformed JSON → `{}`).
- A private `_persist()` writes the current `jar` to localStorage.

### State + actions (default export `useCookieStore`)
- `jar` — the in-memory jar.
- `getCookiesForUrl(url)` → `Cookie[]` — delegates to `cookiesForUrl(get().jar, url)`.
- `setCookiesFromResponse(url, setCookieValues)` — `setCookieValues` is an array of raw `Set-Cookie`
  header strings. For each: `parseSetCookie`, skip nulls. The storage domain key is the cookie's
  explicit `domain` (if present and the URL host domain-matches it) else `getDomainFromUrl(url)`.
  Upserts each, persists once at the end, updates `jar` state.
- `upsert(domain, cookie)` — `upsertCookie`, persist, set state.
- `removeCookie(domain, name)` — `removeCookie`, persist, set state.
- `removeDomain(domain)` — `removeDomain`, persist, set state.
- `getDomains()` → `string[]` — `Object.keys(get().jar)`.

## Acceptance Criteria (from ticket)
- [ ] Jar persists across reloads via localStorage (`pu_cookie_jar`).
- [ ] Store exposes: `getCookiesForUrl`, `setCookiesFromResponse`, `upsert`, `removeCookie`, `removeDomain`, `getDomains`.
- [ ] Domain matching: `example.com` cookie matches `api.example.com` when the domain attribute allows; exact-host fallback for host-only cookies.
- [ ] Expired cookies (past `expires`) filtered out of `getCookiesForUrl`.
- [ ] Pure helpers in `cookies.js` are unit-testable in isolation (no store/DOM coupling).

## Test Framework
Vitest (`vitest run` via `npm run test:unit`), jsdom environment for the store test
(provides `localStorage`). Pure-helper tests need no DOM.
