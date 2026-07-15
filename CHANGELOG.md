# Changelog

## v0.1.22

### Improved

- **New App Icon — Vivid Gradient Underlay (No More Grey Backdrop on macOS)** — The umbrella glyph now sits on a full-bleed diagonal blue → violet → magenta gradient tile instead of floating on transparency. macOS places icons that don't fill their canvas onto a default grey squircle backdrop (Dock and Safari web apps alike), which is what made the old icon look washed out. The entire `src-tauri/icons/` set (`icon.icns`, `icon.ico`, all PNG sizes, Windows Store / Android / iOS variants) was regenerated from a new 1254×1254 master via `tauri icon`, so the desktop bundle picks the icon up on the next `tauri build`. Both web apps (main + marketing site) get a matching 64×64 `favicon.png` and a new 180×180 `apple-touch-icon.png` — full-bleed and opaque, since macOS masks the corners itself and transparent corners are exactly what triggers the grey underlay. The glyph was also redrawn with a proper J-hook handle (the old handle was a closed circle). `umbrella.svg` inline logos (website Hero/Footer/AppMockup, app loading screen) are unchanged.

## v0.1.21

### Fixed

- **Cursor-Selection Copy of a JSON Response Now Produces Valid JSON** — Manually drag-selecting part (or all) of a JSON response body and copying it yielded invalid JSON. `@uiw/react-json-view` lays its tree out as a one-token-per-line DOM stream, so the selectable text drops the separating commas, splits a container key across lines (`"key"` / `:` / `{`), prefixes every array element with its index (`0:"x"`), and carries non-JSON `N items` size badges. The copy interceptor previously only re-inserted commas, which corrupted split container keys (`"slideshow",`). It now reconstructs valid JSON via a container-stack state machine that drops the size badges and array-index prefixes, re-joins split `key`/`:`/value triples, and re-inserts separators — balanced selections come back pretty-printed and valid, partial selections come back separator-repaired. The library's built-in copy button (which uses `navigator.clipboard` directly) is unaffected. Closes #65. (#68)

## v0.1.20

### Fixed

- **Variables Set in a Pre-Request Script Now Resolve in Headers / URL / Body** — `pm.variables.set("token", …)` in a pre-request script had no effect when the variable wasn't already defined somewhere (collection/environment): the request was sent with the literal `{{token}}` left unresolved. The substitution step read from a scope snapshotted before the script ran, so newly-created variables never made it in. `pm.variables` is now a proper transient **local scope** — seeded from earlier scripts in the same execution and accumulated as each script runs — that resolves across URL, query params, headers, body, and auth, with priority **local > environment > collection**. It resolves even when no environment is active, and `pm.variables.unset()` propagates correctly. `pm.environment.set()` continues to create new keys as before. Closes #59. (#61)
- **`pm.collectionVariables.set()` No Longer Silently Drops Undeclared Keys** — Setting a collection variable from a pre/post script only worked if the key was already declared in the collection's Variables tab; a brand-new key was silently discarded at the data layer (no `collection_variables` row to attach the per-user value to), so `{{key}}` stayed unresolved. `updateCollectionVariableCurrentValues` now auto-creates the missing variable (shared declaration with empty `initial_value`, script value stored as the per-user `current_value`) — mirroring how `pm.environment.set()` appends a new env variable. Postman parity. Affects both pre-request and post-response scripts, and the workflow runner. Closes #62. (#63)
- **Variable Popover Reflects Script-Set Collection Variables** — After a pre/post script set a collection variable, hovering the `{{var}}` token still showed the stale value — the execution hooks persisted the change but never refreshed the popover's `collectionVariables` source. The hooks now trigger a collection-variable reload after applying script updates, so the popover shows the current value (matching the environment-variable behavior, which already refreshed). (#63)

### Database

- No migration required. Auto-created collection variables are written through the existing `collection_variables` / `collection_variable_user_values` tables.

## v0.1.19

### New

- **Cookie Jar (Domain-Keyed Storage)** — A local cookie jar lives in `localStorage` under `pu_cookie_jar` and is exposed via a Zustand store (`src/stores/cookieStore.js`) and a set of pure helpers (`src/utils/cookies.js` — `parseSetCookie`, `getDomainFromUrl`, `cookiesForUrl`, `serializeCookieHeader`, `upsertCookie`, `removeCookie`, `removeDomain`). Jar is keyed by domain and supports subdomain / leading-dot matching with host-only exact fallback, path-prefix matching, expiry filtering, and the `Secure` flag (only sent over HTTPS). Mirrors Postman's per-device cookie jar — cookies are device/session-bound and intentionally not synced through Supabase. (#43, #44)
- **Capture `Set-Cookie` from Responses** — Responses now feed the jar. The proxy Edge Function returns un-folded `Set-Cookie` headers as a `setCookies: string[]` field via `response.headers.getSetCookie()` (Deno) — previously `headers.forEach` collapsed multiple `Set-Cookie` into one comma-joined value, losing cookies. Tauri's `http_request` already returns each `set-cookie` as a separate header entry, so it works unchanged. A new pure `extractSetCookies(result)` normalizes capture across transports (proxy `setCookies` field takes precedence; falls back to per-entry `set-cookie` headers; browser-direct path cannot read `Set-Cookie` — it's a forbidden response header — and is documented as a known limitation). `setCookiesFromResponse` removes the matching jar cookie when the parsed `Set-Cookie` is already expired (`Max-Age=0` / past `Expires`) instead of upserting. (#43, #45)
- **Send Cookies on Outgoing Requests** — Both execution hooks (`useResponseExecution`, `useWorkflowExecution`) now call `cookieStore.getCookiesForUrl(resolvedUrl)` after env / collection-variable / auth handling and merge matching jar cookies into the request's `Cookie` header. A new pure `buildCookieHeader(jarCookies, manualCookieValue)` parses any user-supplied `Cookie` value into ordered `name=value` pairs and appends jar cookies whose names aren't already present — **manual values win on collision** (case-sensitive). Browser-direct path silently drops the forbidden `Cookie` header (documented); proxy and Tauri forward it. Header arrays are freshly mapped per request, so the persisted request state is never mutated. (#43, #46)
- **Cookies Tab in Response Viewer** — The Response viewer gains a third tab, **Cookies**, sitting next to **Headers** and rendered **only when the response set ≥1 cookie** (hidden otherwise — including on saved Examples with no cookie data). A new pure `getResponseCookies(response)` derives display rows from a `sendRequest`-shaped result, reusing `extractSetCookies` + `parseSetCookie` + `getDomainFromUrl`. The 8-column read-only table shows Name, Value, Domain, Path, Expires, Secure, HttpOnly, SameSite — `Expires` renders `Session` for non-expiring cookies; `domain` falls back to the resolved URL host when the cookie carries no `Domain` attribute. A fallback `useEffect` resets `activeTab` to `body` when cookies disappear (e.g. a new response arrived). `data-testid` selectors (`response-tab-cookies`, `response-cookies`, `cookie-row`) ship for E2E. (#43, #47)
- **Cookie Manager Dialog** — A new full-jar editor mounted from a **Cookies** button in the Request editor's Auth tab (`data-testid="open-cookie-manager"`). Lists every domain vertically; cookies inside each domain render as horizontal name tags; clicking a tag opens a textarea editor for the value. Add / remove cookies, remove an entire domain (confirm dialog), add a brand-new domain manually, and live-filter domains via the search bar at the top. Dialog has a fixed width / height — the body scrolls internally so the frame size never shifts. The tag row renders first, then a single full-width editor below — opening the editor doesn't resize the selected key tag. (#43, #48, #57)
- **cURL Cookie Round-Trip** — `generateCurl` now emits `-b "name=value; ..."` when cookies apply to the request domain (jar match or manual `Cookie` header), and the cURL import parser handles `-b` / `--cookie` plus `Cookie:` headers passed via `-H`. Round-trips preserve the cookie set; the exported cURL no longer duplicates representation across `-b` and `-H "Cookie:"`. (#43, #49)

### Improved

- **PromptModal Doesn't Leak State Across Chained Prompts** — `PromptProvider` previously reused a single `<PromptModal>` instance across consecutive `prompt()` calls, so opening two prompts back-to-back (e.g. cookie name → cookie value) leaked the previous input value into the next prompt (the cookie-value field arrived pre-filled with the name the user just typed). Provider now bumps a `seq` counter on every `prompt()` and keys the modal by it, forcing a fresh remount per prompt. Fix is shared infrastructure — benefits anything else in the app that chains prompts. (#48, PR #55)
- **Response Viewer Cookies — Value Column No Longer Widens the Table** — The Value column is now capped to one line with ellipsis by default and reveals the full value by **wrapping onto multiple lines** (not by growing the column) on hover or click. Long session tokens stop forcing horizontal scroll. (#57)
- **Request Editor — Cookies Button Compact** — The Cookies entry point on the Auth tab is smaller and visually quieter. (#57)

### Database

- No schema changes. The cookie jar is local-only (`localStorage`); no Supabase migration required.

## v0.1.18

### Fixed

- **Cannot Insert `:` Between Existing URL Segments to Create a Path Variable** — `sanitizeUrlForPathVars` in `src/utils/substituteVariables.js` stripped any `:` immediately followed by a URL-reserved character on every keystroke. That worked when typing from end-of-URL (the user types `:`, then `/`, and the colon collapses), but it also fired when the user *inserted* `:` to the left of an existing `/`. So changing `/items/123/detail` to `/items/:id/detail` was impossible — selecting `123`, deleting it, and typing `:` produced `/items/:/detail` for one keystroke before sanitize stripped the colon, leaving `/items//detail`. Sanitize is now caret-aware: a `:` at index `c` is stripped only when `caretPos === c + 2` (the user just typed the reserved character right after the colon). Inserting `:` between existing segments succeeds; the original v0.1.15 strip rule for typed-from-end `:/` is preserved unchanged. Closes #40. (#41)

## v0.1.17

### Fixed

- **Invite User / Delete User / Add Workspace Member Threw `PROXY_FUNCTION_URL is not defined`** — `src/data/supabase/users.js` referenced `PROXY_FUNCTION_URL` when building the Edge Function URLs for `inviteUser`, `deleteUser`, and `addWorkspaceMember`, but only `supabase` was imported from `./client.js`. Every admin-side user management action threw a `ReferenceError` at the `fetch(` call. Added `PROXY_FUNCTION_URL` to the import.

## v0.1.16

### Fixed

- **JSON Response String Truncation Broke Copy-Paste** — `@uiw/react-json-view` truncates long string values to 30 chars and toggles between truncated/full on click. Because the toggle was wired to a plain `onClick` on the same `<span>` that holds the text, drag-selecting inside the expanded value to copy fired a second `click` on `mouseup` and collapsed it before the user could finish — making partial copies impossible. Truncation is now disabled outright (`shortenTextAfterLength={0}`); existing wrap CSS (`.w-rjv-line { word-break: break-all; white-space: pre-wrap; }`) keeps long values visible without horizontal scroll. Also simplifies the search code path that previously had to disable truncation only while a query was active.

## v0.1.15

### New

- **Path Variables in Request URL** — Postman-style `:name` path variables, scoped per-request. Typing `:id` in the URL adds a row to a new "Path Variables" section under the Params tab; deleting the `:name` from the URL removes the row. Keys are read-only in the list (edit them in the URL); values are editable inline or via the same hover popover used for environment variables. Path-var values may reference `{{env_var}}` — they're resolved before substitution into the URL. Distinct green accent (`--accent-success`) in the URL overlay distinguishes path vars from env (blue) and collection (orange). Closes #38. (#39)
- **Reserved-Character URL Sanitization** — Typing `:` followed immediately by a URL-reserved character (`/`, `?`, `#`, `&`, `=`, etc.) strips the stray `:` from the URL — `/users/:/posts` collapses to `/users//posts` instead of creating a no-name path variable. Trailing `:` at end of URL is preserved so users can keep typing the name. (#39)
- **Port- and Query-Aware Path-Var Parser** — The parser explicitly skips `:` inside `scheme://host:port` and stops at the first `?` or `#`, so `https://localhost:3000/api/:id` and `/api/:id?ts=2024:01:01` both produce exactly one path variable (`id`) — not three bogus ones. (#39)

### Improved

- **Shared Substitution Util** — Three previously-duplicated env/collection-variable substitution sites (`useResponseExecution`, `useWorkflowExecution`, `CurlPanel`) now share a single `src/utils/substituteVariables.js` with a merged-Map env-then-collection priority pass. Both the live request and the cURL preview run identical pipelines, so the cURL never drifts from what was actually sent. (#39)
- **Compact Key/Value Tables** — Query Params, Path Variables, Headers, and Body→form-data tables share a `.kv-section` style with tighter row padding (4px input padding, 9px header font) so more rows are visible at once without scrolling. The form-data Type selector and Select File button shrunk to match. (#39)
- **Response JSON Dock Shadow** — The floating dock no longer carries its accent ring + ambient drop-shadow at rest. Both layers fade in (150ms) on `:hover` or `:focus-within` (search input or button focus). Reads quieter against busy JSON. (#39)
- **cURL Paste Wires Path Variables** — Pasting a `curl` command containing a templated URL (e.g. `https://api/users/:id`) now reconciles path variables on paste so the section appears immediately, instead of waiting for the user to type. (#39)

### Fixed

- **Workflow Env-vs-Collection Override Bug** — When a collection variable and an environment variable defined the same key, the workflow executor's sequential-replacement substitution erased the `{{key}}` pattern after the first pass — so the second pass (env) had nothing to override and the collection value silently won. The new shared util uses a merged-Map pattern so env reliably wins regardless of order. Pre-existing in `useWorkflowExecution.js` since v0.1.8; fixed as a side benefit of the substitution refactor. (#39)
- **Tab Dirty-State Snapshot Missed `path_variables`** — `openRequestInTab` built its dirty-detection snapshot inline and was missing `path_variables`, so any edit to a fresh tab produced a permanent dirty mismatch (snapshot key omitted vs current key present). Bulk close-tab actions then opened a "Close anyway?" confirm modal that surprised users (and broke 5 tab-context-menu E2E tests). Fixed by including `path_variables` in the snapshot, matching the WorkbenchContext / workbenchStore / useConflictResolution paths. (#39)

### Database

- **Migration `20260424000000_request_path_variables.sql`** — Adds `path_variables JSONB DEFAULT '[]'::jsonb` column to `requests`. Existing rows get `[]` automatically; the new section stays hidden until users add `:name` to a URL. Run `supabase db push` to apply to cloud projects.

## v0.1.14

### New

- **Response Viewer Float Dock** — A floating control cluster pinned to the top-right of the JSON response viewer, with three actions: **Search**, **Expand-all**, **Collapse-all**. Replaces the toolbar-mounted expand/collapse icons from v0.1.13. The dock stays visible as you scroll through large responses and adapts its border + shadow for both light and dark themes. Closes #36. (#37)
- **In-Viewer Search with Auto-Expand** — Clicking the dock's magnifier (or pressing **Ctrl+F / Cmd+F** while focus is inside the response viewer) opens an inline search bar with input, live `N / M` counter, prev/next buttons, and close. The search walks the **parsed JSON** rather than the rendered DOM — so matches inside collapsed nodes are found, and the ancestor path of every match is automatically expanded so you can see it. Matches are highlighted with inline `<mark>` spans, and navigation scrolls the active match into view. Escape closes. Browser Find is suppressed while focus is inside the viewer; Ctrl+F anywhere else works normally. Closes #36. (#37)
- **Substring Match Across All Leaf Types** — Search compares case-insensitively against every key name and every stringified leaf (string values, numbers, booleans, `null`, `undefined`, `NaN`). `"12"` finds `"123"` and the number `123`; `"tru"` finds boolean `true` or the string `"true"`; `"ull"` finds `null`. Quote-inclusive queries work too — `"route_id"` (with quotes) matches the key `route_id` the same as typing it bare. Up to 5000 matches are kept; beyond that the counter shows `N / 5000+`. (#37)
- **Sticky Search Expansion** — Typing a query that yields zero matches, or closing the search bar mid-session, no longer snaps the tree back to its pre-search collapse state. The expansion hints from the most recent non-empty match set persist, so a typo or Escape doesn't wipe the context you were reading. Explicit Collapse-all, Expand-all, or a new response clears the sticky state as usual. (#37)
- **Landing Page Dock Demo** — The marketing page mockup (`website/`) now shows the response-viewer dock. Clicking the magnifier opens a pre-filled "jane" search with two inline highlights on the Create User response, mirroring what the real app does. Advertises the feature without a screenshot. (#37)

### Improved

- **Default JSON Render is Fully Expanded** — Previously the response viewer opened every JSON response with depth-2 collapse (`collapsed={2}`). With the dock's Collapse-all button always one click away, the default now shows everything expanded. If you want the collapsed view, use the dock. (#37)
- **Instant Match Navigation** — Clicking Next/Prev (or pressing Enter / Shift+Enter) on a match jumps instantly instead of smooth-scrolling, which felt sluggish when stepping through many matches in a large response. (#37)

### Fixed

- **Theme-Switch Flicker on Inputs and Cards** — Toggling light/dark themes caused a visible ~100 ms blink on elements that declared `transition: all` or explicit transitions on theme-token properties (`background`, `color`, `border-color`). Those elements faded over the transition while `<body>` and untransitioned containers snapped instantly, producing a mismatch. Introduced a one-frame global transition guard (`html.theme-switching *`) applied by `useLayoutState` around the `[data-theme]` flip so every element snaps together. Interaction transitions (hover, focus) are unaffected. Specifically resolves the blink on the params/headers inputs and the sidebar search bar. (#37)
- **`@uiw/react-json-view` KeyName Render Propagation** — An internal render-prop override for `<JsonView.KeyName>` was reading the wrong field (`value` from the 2nd callback arg, which the library uses for the *value at* the key, not the key name itself). With the new search feature relying on key highlighting, the bug would have caused key matches to silently miss. Fixed to read `keyName` explicitly, matching the library's signature. (#37)

### Breaking

- **Response Viewer's Default Collapse Behavior Changed.** JSON responses now render fully expanded on arrival instead of collapsed at depth 2. If you relied on the old depth-limited default, click the new Collapse-all icon in the top-right dock. (#37)
- **Expand / Collapse Buttons Moved from Toolbar to the Float Dock.** The toolbar buttons introduced in v0.1.13 are gone; the same actions live inside the new `response-json-dock` element. Test selectors (`response-expand-all-btn`, `response-collapse-all-btn`) are preserved so existing E2E tests that target them by `data-testid` keep working. (#37)

## v0.1.13

### New

- **OpenAPI / Swagger Import** — Import OpenAPI 3.x or Swagger 2.x specs (JSON or YAML) via the Import Modal. Tags map to folders, `servers[0].url` seeds a `{{baseUrl}}` collection variable, path parameters become `{{param}}`, security schemes map to Bearer auth or API Key headers/query. Request/response examples carry through when the spec provides them. Closes #30. (#30, #33)
- **Multi-Format Import Modal** — Import now opens a step-by-step modal where you pick the source format (Postman, Insomnia, Post Umbrella, OpenAPI/Swagger), upload a file, preview the outcome (collection/folder/request/variable counts + warnings list), and confirm before anything is written. The old implicit "pick any JSON and hope" flow is replaced by explicit format selection + schema validation. (#30, #32)
- **Insomnia v4 Import** — Full Insomnia v4 export parsing: workspaces, request groups (folders), requests (method/URL/headers/body/auth), and base environment variables. Insomnia `{% response 'body', 'req_<id>', 'b64::<jsonpath>::<hash>' %}` template tags are automatically rewritten: the producing request gains a post-response script that extracts the referenced value and saves it as a collection variable, while the consuming request's token becomes `{{slug_token}}`. Unresolvable tags become `{{TODO_FIX_insomnia_response}}` with a warning. Other Insomnia tags (`{% uuid %}`, `{% timestamp %}`, etc.) map to their Postman equivalents or `{{TODO_FIX_...}}` placeholders. (#30, #32)
- **Schema Validation on Import** — Every import file is validated against a bundled JSON Schema before any DB write (Postman v2.1/v2.0, Insomnia v4, Post Umbrella v1, OpenAPI 3.x / Swagger 2.x). Validation failures surface in a detailed error panel listing the JSON path and expected shape for each problem. (#30, #32, #33)
- **Postman Dynamic Variable Seeding** — `{{$guid}}`, `{{$timestamp}}`, `{{$randomInt}}`, `{{$randomUUID}}`, `{{$isoTimestamp}}` in imported Postman files auto-seed matching collection variables. Unknown dynamics produce a warning. (#30, #32)
- **Tab Right-Click Context Menu** — Right-clicking an open tab opens a menu with Close, Close Other Tabs, Close Unmodified Tabs, Close Tabs to the Left, and Close Tabs to the Right. Items hide when they would do nothing. Closing the active tab now shifts focus to its right neighbor (fallback left) for both the menu and the × button. Closes #27. (#28)
- **Response Download Button** — A Download icon button in the response toolbar saves the response body to disk for any non-empty body. Routes by content-type: binary (image/pdf/audio/video/zip/octet-stream/vnd.*) decodes base64 to bytes; JSON pretty-prints with 2-space indent; text family (html/css/xml/plain/js/etc.) writes as-is. Filename comes from `Content-Disposition` (quoted, unquoted, and RFC 5987 `filename*` all supported), falling back to the URL's last path segment + MIME extension, then a `response.<ext>` default — all OS-sanitized. Tauri uses the native Save As dialog via `plugin-dialog`; browser uses a standard `<a download>` trigger. A new `write_binary_file` Tauri command handles byte writes. The old inline `Download PDF` link inside the PDF `<object>` fallback is removed in favor of the toolbar button. Closes #29. (#35)

### Improved

- **Postman Import/Export Round-Trip** — Exporting a collection now preserves bearer auth, `Inherit from Parent` auth, folder/collection-level auth, pre/post scripts (request and collection level), and collection variables. Importing recognizes Postman's `event[]` script format and maps API Key auth (header location) into a request header. Basic, OAuth 1.0, OAuth 2.0, and unknown auth types no longer silently drop — they surface a per-request warning in a new "Import Warnings" modal. (#30, #31)
- **Export Performance** — `exportCollection` now fetches only the target collection's subtree instead of every collection in the workspace, fixing a pre-existing duplicate-folder bug and reducing DB reads. (#30, #31)

### Fixed

- **`null` / `undefined` / `NaN` Rendered as Empty in JSON Response Viewer** — `{ "key": null }` was showing as `"key":` with nothing after the colon. Root cause is a bug in `@uiw/react-json-view@2.0.0-alpha.41`: `TypeNull` / `TypeUndefined` / `TypeNan` lack the value-text fallback that the other type components have, so when `displayDataTypes={false}` they render nothing. Worked around by providing explicit `render` overrides via the `JsonView.Null` / `Undefined` / `Nan` slots. Upstream bug filed as [uiwjs/react-json-view#91](https://github.com/uiwjs/react-json-view/issues/91).

### Breaking

- **Postman collection-level `variable[]` now imports as collection variables.** Previously, importing a Postman file with top-level `variable[]` silently created a new Environment named `"<Collection> Variables"`. It now creates Post Umbrella collection variables on the imported root collection (matching the v0.1.8 collection-variables feature). Users who relied on the old behavior should recreate the environment manually or re-scope the values to collection variables. (#30, #31)
- **Import UX changed.** The old single-click "Collection File" import path is replaced by the new multi-step ImportModal. The "From cURL" flow is unchanged. (#30, #32)
- **PDF inline download link removed.** The `Download PDF` anchor inside the PDF `<object>` fallback is replaced by the new toolbar Download button. Users who relied on the inline link should use the toolbar button instead. (#29, #35)

## v0.1.12

### New

- **Image Response Preview** — Responses with `image/*` content types (PNG, JPEG, WebP, GIF, SVG) now render inline as an actual image in the Response Viewer instead of dumping raw binary text. Edge Function proxy, browser-direct fetch path, and the Tauri desktop `http_request` command all base64-encode binary bodies so the bytes survive the JS bridge intact. (#21)

### Improved

- **Sidebar Expand/Collapse Works During Search** — Clicking expand-all or collapse-all while a search query is active now actually does something. Typing a query auto-expands matching branches; expand-all unfolds all matching collections + their ancestors; collapse-all folds them back to headers only. As a side benefit, expand-all without a search now recurses into nested subfolders too (previously only root-level). (#21)
- **Copy as cURL Honors Inherited Auth & Variables** — When a request uses "Inherit from Parent" auth, the cURL output now includes the parent collection's Bearer token. When a token contains `{{variable}}`, both environment and collection variables are substituted (environment wins on conflicts). (#21)

### Fixed

- **New Variable Values Were Silently Dropped** — Adding a new environment or collection variable in the editor was saving the variable with an empty value due to a reference-equality bug in the `isNew` detection (`editingVars.indexOf(v)` against a mapped copy always returned -1). Values now persist correctly on first save.
- **Env Vars Truly Override Collection Vars** — When both an environment variable and a collection variable defined the same key, the previous substitution loop replaced the collection value first, erasing the `{{key}}` pattern before the environment value could win. Substitution now uses a single-pass merged map so environment values reliably override.
- **Optimistic Collection Save** — Saving auth or pre/post scripts on a collection now updates the in-memory collection list immediately, so the cURL preview and auth inheritance reflect the change without waiting for the realtime broadcast round-trip.

## v0.1.11

### New

- **Global Console Panel** — Console logs are now a persistent bottom panel instead of a per-request tab in the Response Viewer. Logs from all request executions are collected globally, tagged with request name and timestamp. Includes clear and close buttons. (#18)
- **Embedded Terminal** — Full interactive terminal (PowerShell on Windows, bash on Mac/Linux) embedded in the bottom panel. Supports multiple simultaneous terminals with tabs, restart, and theme-synced colors. Tauri desktop app only. (#18)
- **Bottom Status Bar** — Persistent bar at the bottom of the window with Console and Terminal toggle buttons, log count badge, and error indicator.
- **Global Error Boundary** — React error boundary wraps the app with a fallback UI ("Something went wrong" + Reload button). WebSocket connection status banner shows reconnecting/disconnected state. (#14)
- **MCP Session Persistence** — MCP server sessions now survive server restarts. Tokens stored in a `mcp_sessions` Supabase table instead of in-memory. Users no longer need to re-authenticate after deployments. (#16)

### Improved

- **Code Architecture** — Major refactoring of the two largest files:
  - `App.jsx` reduced from 1,270 to 619 lines — extracted `useRealtimeSync`, `useClipboardLinks`, `useCollectionVariables`, `useTauriClose` hooks, `CurlPanel` component, and `modalStore`
  - `Sidebar.jsx` reduced from 1,275 to 995 lines — extracted `useSidebarDragDrop` hook with all drag-and-drop logic
  - `JsonEditor.jsx` reduced from 473 to 183 lines — extracted `jsonLinter`, `jsonComments`, `jsonEditorTheme` utils
- **Drag & Drop Reorder** — Fixed forward-drag placing items at wrong position (off by one). Added optimistic UI updates so reorder/move reflects immediately without waiting for WebSocket events.
- **Sidebar Resize Handle** — Changed from 3px transparent gap to 1px border line for a cleaner look.

### Fixed

- **JSON Comment Preservation** — Comments on closing bracket lines (`}, // comment`) now survive beautify. Previously only inline comments on key-value lines were preserved. (#13)
- **Drag Reorder Not Updating UI** — Reordering or moving requests via drag-and-drop now updates the sidebar immediately via optimistic state updates, independent of WebSocket/Realtime connection status.
- **Missing Import** — Fixed `syncCloseBehaviorToRust` not imported in refactored `App.jsx`, which would crash Tauri desktop users with saved close behavior preferences.

## v0.1.10

### New

- **HTML Response Preview** — When a response has `Content-Type: text/html`, the Response Viewer automatically renders it in a sandboxed iframe. Toggle between Preview (rendered) and Raw (source code) views. JSON responses still take priority — if the body parses as JSON, the tree view is shown regardless of Content-Type. (#10)
- **Request Body Error Reporting** — The JSON body editor now uses `jsonlint-mod` to detect syntax errors in real-time with inline error underlines. Errors near `{{variable}}` patterns are no longer incorrectly suppressed. (#7)
- **Human-Readable Lint Messages** — JSON syntax errors now show clear messages: "Expected comma", "Expected ':' after property name", "Trailing comma is not allowed" instead of raw parser output.
- **MCP Slack Auth** — The MCP server now supports Slack OAuth for authentication, with a dedicated authorize/complete flow. (#6)

### Improved

- **Unified Option Selector Styling** — Body type, auth type, and HTML view toggle buttons now share a single `.option-selector` CSS class with consistent pill-style appearance (padding, gap, colors, active state).
- **Code Architecture** — Major refactoring across the codebase:
  - Split monolithic `supabase/index.js` (2,300+ lines) into domain modules: `auth.js`, `collections.js`, `requests.js`, `examples.js`, `environments.js`, `collectionVars.js`, `workflows.js`, `proxy.js`, `sync.js`, `users.js`, `helpers.js`
  - Extracted `AppModals` from `App.jsx` (~270 lines), `RequestBodyEditor` from `RequestEditor.jsx` (~225 lines), `ExampleItem` and `RequestItem` from `Sidebar.jsx` (~240 lines)
  - Replaced context-based state (`WorkbenchContext`, `AuthContext`, `WorkspaceContext`) with lightweight Zustand stores (`workbenchStore`, `authStore`, `workspaceStore`, `collectionStore`)
  - Extracted reusable hooks: `useDragPreview`, `useInlineRename`, `useLocalStorage`
- **E2E CI Pipeline** — Added GitHub Actions workflow for automated E2E testing with Supabase local stack.
- **Landing Page** — Fixed button hover color issue on the marketing website.

## v0.1.9

### New

- **API Documentation Viewer** — Right-click a collection → "View Docs" to generate browsable API documentation from your requests and saved examples. Includes search, per-request expandable details (URL, headers, params, body, auth), and example request/response pairs. Cached for instant tab switching with manual refresh.

### Improved

- **Drag & Drop UX** — Custom drag ghost previews showing method badge + name when dragging requests, folders, and examples in the sidebar. Drop indicators no longer cause layout shifts (use CSS pseudo-elements instead of borders). Workflow step drag area no longer flickers.
- **CSS Architecture** — Split `App.css` (6,100+ lines) into feature-specific files: `sidebar.css`, `request-editor.css`, `response-viewer.css`, `variables.css`, `modals.css`. Easier to maintain and navigate.
- **Component Extraction** — Extracted `AppHeader` and `TabBar` from `App.jsx` (~250 lines moved), reducing it from 1,700 to 1,470 lines.
- **JSON Response Viewer** — Scrollbar now stays within the JSON view container, keeping border-radius visible at all times.
- **JSON Editor Selection** — Improved text selection visibility in light mode with proper syntax highlighting via `HighlightStyle.define()`.
- **E2E Test Coverage** — 40/40 flows covered (100%). Added collection variables, auth, workflow, and admin test suites. Automatic cleanup of test data after each run.

### Fixed

- **Environment Test Stability** — Added environment cleanup helper to prevent test data accumulation causing timeouts.
- **Security** — Removed hardcoded Supabase service role key from test files. Now loaded via environment variables with `dotenv`.

## v0.1.8

### New

- **Workflow Builder** — Create, save, and run reusable API request flows. Drag requests from the sidebar into a workflow, reorder steps, and execute them sequentially with real-time status feedback. Workflows live under their root collection in the sidebar.
- **Collection Variables** — Define shared variables at the collection level. Use `{{key}}` in URLs, headers, body, and auth fields. Collection variables (orange) are visually distinct from environment variables (blue).
- **Collection & Folder Auth** — Set Bearer Token auth at the collection or folder level. Requests can inherit auth from their parent using the "Inherit from Parent" option.
- **Pre/Post Scripts** — Collection-level pre-request and post-response scripts run before/after every request in the collection. Scripts support both `pm.environment` and `pm.collectionVariables` APIs.
- **Variable Popover** — Hover any `{{variable}}` in URL inputs or the JSON body editor to preview its value and source. Click to edit inline. Works across all input types.

### Improved

- **JSON Body Editor** — `{{variable}}` patterns are now highlighted with source-aware colors, autocomplete triggers on `{{`, and hover shows variable preview with click-to-edit. Beautify/minify works correctly with template variables.
- **Variable Format** — Variables can now store JSON objects. The popover displays formatted JSON in view mode and provides a textarea editor for editing.
- **Whitespace Tolerance** — `{{ key }}` with extra spaces is treated the same as `{{key}}` everywhere: highlighting, substitution, hover, and beautify normalizes them.
- **Workflow Execution** — Workflows run root collection pre/post scripts once (before first step, after last step). Request-level scripts run per step. Supports dirty tab state (unsaved request changes are used when running).
- **Sidebar** — Workflows appear under their collection. "Add Workflow" available in collection context menu. Toggle button to show workflows only. Arrow click expands/collapses without opening the tab.
- **Tab Badges** — Collection, folder, and workflow tabs now show icons instead of text abbreviations.
- **Consistent Method Colors** — HTTP method colors unified across tab bar, sidebar, method selector, and workflow editor.

### Fixed

- **Script Variable Persistence** — `pm.collectionVariables.set()` and `pm.environment.set()` correctly handle `undefined`/`null` values (stores empty string instead of literal "undefined").
- **Trim on Save** — Variable keys, values, URLs, and `{{}}` patterns are trimmed on save across request editor, environment editor, and collection variable editor.

## v0.1.7

### New

- **Slack Login** — Sign in with your Slack account. Desktop app shows a waiting screen while you authenticate in the browser.
- **Clipboard Share Links** — Copy a share link, switch to the app, and a toast prompts you to open it directly.
- **Toast Action Buttons** — Toasts can now include inline action buttons (used by clipboard detection and session restore).

