# Changelog

## Unreleased

### New

- **OpenAPI / Swagger Import** — Import OpenAPI 3.x or Swagger 2.x specs (JSON or YAML) via the Import Modal. Tags map to folders, `servers[0].url` seeds a `{{baseUrl}}` collection variable, path parameters become `{{param}}`, security schemes map to Bearer auth or API Key headers/query. Request/response examples carry through when the spec provides them. Closes #30. (#30)
- **Multi-Format Import Modal** — Import now opens a step-by-step modal where you pick the source format (Postman, Insomnia, Post Umbrella; OpenAPI reserved for a future release), upload a file, preview the outcome (collection/folder/request/variable counts + warnings list), and confirm before anything is written. The old implicit "pick any JSON and hope" flow is replaced by explicit format selection + schema validation. (#30)
- **Insomnia v4 Import** — Full Insomnia v4 export parsing: workspaces, request groups (folders), requests (method/URL/headers/body/auth), and base environment variables. Insomnia `{% response 'body', 'req_<id>', 'b64::<jsonpath>::<hash>' %}` template tags are automatically rewritten: the producing request gains a post-response script that extracts the referenced value and saves it as a collection variable, while the consuming request's token becomes `{{slug_token}}`. Unresolvable tags become `{{TODO_FIX_insomnia_response}}` with a warning. Other Insomnia tags (`{% uuid %}`, `{% timestamp %}`, etc.) map to their Postman equivalents or `{{TODO_FIX_...}}` placeholders. (#30)
- **Schema Validation on Import** — Every import file is validated against a bundled JSON Schema before any DB write (Postman v2.1/v2.0, Insomnia v4, Post Umbrella v1). Validation failures surface in a detailed error panel listing the JSON path and expected shape for each problem. (#30)
- **Postman Dynamic Variable Seeding** — `{{$guid}}`, `{{$timestamp}}`, `{{$randomInt}}`, `{{$randomUUID}}`, `{{$isoTimestamp}}` in imported Postman files auto-seed matching collection variables. Unknown dynamics produce a warning. (#30)

### Improved

- **Postman Import/Export Round-Trip** — Exporting a collection now preserves bearer auth, `Inherit from Parent` auth, folder/collection-level auth, pre/post scripts (request and collection level), and collection variables. Importing recognizes Postman's `event[]` script format and maps API Key auth (header location) into a request header. Basic, OAuth 1.0, OAuth 2.0, and unknown auth types no longer silently drop — they surface a per-request warning in a new "Import Warnings" modal. Part 1 of 3 for #30. (#30)
- **Export Performance** — `exportCollection` now fetches only the target collection's subtree instead of every collection in the workspace, fixing a pre-existing duplicate-folder bug and reducing DB reads. (#30)

### Breaking

- **Postman collection-level `variable[]` now imports as collection variables.** Previously, importing a Postman file with top-level `variable[]` silently created a new Environment named `"<Collection> Variables"`. It now creates Post Umbrella collection variables on the imported root collection (matching the v0.1.8 collection-variables feature). Users who relied on the old behavior should recreate the environment manually or re-scope the values to collection variables. (#30)
- **Import UX changed.** The old single-click "Collection File" import path is replaced by the new multi-step ImportModal. The "From cURL" flow is unchanged. (#30)

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

