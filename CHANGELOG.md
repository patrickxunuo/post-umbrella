# Changelog

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

