# Progress

## Current Sprint / Focus
v0.1.8 released — Workflow Builder, Collection Variables, Auth Inheritance

## Log
<!-- Newest entries first. Format: - YYYY-MM-DDTHH:MMZ [status] feature-name — notes -->
- 2026-05-21T00:00Z [DONE] capture-set-cookie — GH-45 (PR #51), part of Cookie Support epic (#43). Capture `Set-Cookie` from responses into the GH-44 cookie jar. Proxy Edge Function (`supabase/functions/proxy/index.ts`) now returns un-folded `setCookies: string[]` via `response.headers.getSetCookie()` while keeping the `headers` array intact for display. New pure `extractSetCookies(result)` in `src/utils/cookies.js` normalizes capture across transports: proxy `setCookies` field (precedence) / Tauri separate `set-cookie` header entries / browser empty + null-safe. `setCookiesFromResponse` (cookieStore) now removes the matching cookie (by name, under resolved domain) when a parsed Set-Cookie is already expired (`expires != null && expires <= Date.now()`, i.e. Max-Age=0 / past Expires) instead of upserting. Execution hooks (`useResponseExecution`, `useWorkflowExecution`) wire best-effort capture via `resolvedUrl` after each response, before post-scripts. No Rust change — Tauri `http_request` (`lib.rs`) already returns set-cookie as separate header entries. Browser direct path cannot capture (Set-Cookie is a forbidden response header) — documented with a code comment. 15 new Vitest tests (76 total). No E2E (no UI surface yet; deferred to the cookie-management UI issue).
- 2026-05-21T00:00Z [DONE] cookie-jar-storage — GH-44, foundation for Cookie Support epic (#43). New pure helpers `src/utils/cookies.js` (parseSetCookie, getDomainFromUrl, cookiesForUrl, serializeCookieHeader, upsertCookie/removeCookie/removeDomain — all pure, return new jar) and zustand store `src/stores/cookieStore.js` (manual localStorage persistence, key `pu_cookie_jar`, exposes getCookiesForUrl/setCookiesFromResponse/upsert/removeCookie/removeDomain/getDomains). Domain-keyed jar with subdomain/leading-dot matching + host-only exact fallback, path-prefix match, expiry filtering, secure-only-on-https. Introduced Vitest as the unit-test framework (`npm run test:unit`, jsdom env) — first unit tests in the project; 61 tests. No UI in this issue.
- 2026-05-05T00:00Z [DONE] path-var-insert-fix — Bugfix #40. `sanitizeUrlForPathVars` is now caret-aware: a `:` followed by a reserved char (other than `:`) is stripped only when `caretPos === colonIdx + 2` (the user just typed the reserved char right after the colon). Inserting `:` between two existing `/`s — the natural flow when changing a literal segment to a path variable — now succeeds. `RequestEditor.handleUrlChange` accepts caretPos and forwards `e.target.selectionStart` from the URL input. All 4 prior strip-rule regression tests continue to pass; new E2E `f2-insert-colon-between-segments` covers the bug.
- 2026-04-27T00:00Z [DONE] path-variables — Postman-style path variable support (`/users/:id`). New `path_variables` JSONB column on `requests`; new shared `src/utils/substituteVariables.js` consolidating env/path-var substitution previously duplicated across `useResponseExecution`, `useWorkflowExecution`, `CurlPanel` (also fixes pre-existing workflow override bug where env couldn't override same-named collection var). Path Variables section inside Params tab below query params. URL parser skips `:` inside `scheme://host:port` and stops at `?`/`#`. EnvVariableInput overlay highlights `:name` green (via `--accent-success`) when caller passes `pathVariables` prop; VariablePopover extended with `kind:'path'` for hover-edit. Closes #38.
- 2026-04-16T00:00Z [DONE] response-download — Download button on response toolbar for all body types (binary/JSON/text). New `src/utils/downloadResponse.js` helper; new Tauri `write_binary_file` command. Closes #29
- 2026-04-16T00:00Z [DONE] v0.1.8 release — Changelog, README, website features updated
- 2026-03-25T00:00Z [DONE] variable-popover-shared — Extracted VariablePopover to top-level context provider, shared across EnvVariableInput and JsonEditor
- 2026-03-25T00:00Z [DONE] json-editor-variables — CodeMirror extension for {{var}} highlighting, autocomplete, hover preview in JSON body editor
- 2026-03-25T00:00Z [DONE] json-variable-support — pm.collectionVariables/environment .set() stores objects as JSON, .get() auto-parses
- 2026-03-25T00:00Z [DONE] workflow-collection-scope — Workflows scoped to root collections (collection_id), sidebar integration, collection context menu
- 2026-03-25T00:00Z [DONE] workflow-scripts — Root collection pre/post scripts run once per workflow execution, request scripts per step
- 2026-03-25T00:00Z [DONE] trim-on-save — Variable keys/values, URLs, {{}} patterns trimmed on save everywhere
- 2026-03-25T00:00Z [DONE] method-colors-unified — Extracted METHOD_COLORS to shared constants/methodColors.js
- 2026-03-24T00:00Z [DONE] workflow-builder — Full workflow feature: data layer, execution hook, editor component, sidebar section, tab integration
- 2026-03-24T00:00Z [DONE] collection-variables — Collection-scoped variables with per-user values, pm.collectionVariables API
- 2026-03-24T00:00Z [DONE] collection-auth-scripts — Bearer token auth inheritance, pre/post scripts at collection level
- 2026-03-24T00:00Z [DONE] env-variable-colors — Distinct colors for env (blue) vs collection (orange) variables
- 2026-03-24T00:00Z [DONE] collection-tabs — Overview, Variables, Auth, Pre-script, Post-script tabs for collections
- 2026-03-06T00:00Z [DONE] supabase-migration — Full migration from MySQL/Express to Supabase
- 2026-03-06T00:00Z [DONE] workspace-scoped-environments — Environments per workspace with per-user current values
- 2026-03-06T00:00Z [DONE] sidebar-toolbar — Scroll-to-active, expand-all, collapse-all, workflow filter toggle

## Planned
- [ ] MCP server tools for collection variables and workflows
- [ ] Sidebar refactor — further extraction of CollectionItem, RequestItem, ExampleItem components
