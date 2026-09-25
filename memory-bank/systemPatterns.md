# System Patterns

## Project Structure

```
post-umbrella/
├── src/                        # React frontend
│   ├── components/
│   │   ├── Sidebar/            # Sidebar (folder with index.jsx, Sidebar.jsx, SidebarWorkflows.jsx)
│   │   ├── WorkflowEditor.jsx  # Workflow builder and runner
│   │   ├── CollectionEditor.jsx # Collection settings (auth, scripts, variables)
│   │   ├── RequestEditor.jsx   # Request builder
│   │   ├── ResponseViewer.jsx  # Response display
│   │   ├── JsonEditor.jsx      # CodeMirror JSON editor with variable support
│   │   ├── EnvVariableInput.jsx # Input with {{variable}} highlighting + autocomplete
│   │   ├── VariablePopover.jsx # Shared variable hover/edit popover (context provider)
│   │   └── ...                 # Other components
│   ├── hooks/
│   │   ├── useResponseExecution.js  # Single request execution
│   │   ├── useWorkflowExecution.js  # Sequential workflow execution
│   │   ├── useRequestActions.js     # Tab management (open, close, create, delete)
│   │   ├── useWebSocket.js          # Supabase Realtime subscription
│   │   └── useLayoutState.js        # Sidebar/panel resize state
│   ├── contexts/
│   │   ├── WorkbenchContext.jsx # Global state (tabs, collections, workflows, environments)
│   │   ├── AuthContext.jsx     # Authentication state
│   │   └── WorkspaceContext.jsx # Workspace state
│   ├── utils/
│   │   ├── scriptRunner.js     # pm.* API sandbox for pre/post scripts
│   │   └── envVariableExtension.js # CodeMirror extension for {{var}} highlighting
│   ├── constants/
│   │   └── methodColors.js     # Shared HTTP method color map
│   ├── data/supabase/          # Supabase client and all CRUD operations
│   ├── styles/                 # Feature-specific CSS files
│   ├── App.jsx                 # Main app component (~1700 lines)
│   ├── App.css                 # Global styles (~5000+ lines)
│   └── main.jsx                # Entry point with providers
├── supabase/
│   ├── functions/proxy/        # Edge Function (HTTP proxy for CORS bypass)
│   └── migrations/             # PostgreSQL migrations (timestamped SQL files)
├── src-tauri/                  # Desktop app (Tauri v2 / Rust)
├── mcp-server/                 # MCP server (Node.js / TypeScript)
├── website/                    # Landing page (React / Vite)
└── memory-bank/                # Project memory
```

## Naming Conventions
- Files: PascalCase for components (`RequestEditor.jsx`), camelCase for hooks/utils (`useWorkflowExecution.js`)
- Functions/methods: camelCase
- React components: PascalCase
- Database tables/columns: snake_case
- CSS classes: kebab-case
- Constants: UPPER_SNAKE_CASE for objects (`METHOD_COLORS`), camelCase for functions

## Code Patterns

### Data Layer Pattern
All CRUD in `src/data/supabase/index.js`:
- Exports async functions (`getRequest`, `createWorkflow`, etc.)
- Uses Supabase PostgREST client
- JSON fields parsed on read, stringified on write
- `checkAuth()` helper for operations needing user ID
- Re-exported via `src/data/index.js`

### Tab System
- Tab types: `request`, `example`, `collection`, `workflow`
- Each tab has: `{ id, type, entityId, dirty, [type-specific data] }`
- `originalRequestsRef` tracks initial state for dirty detection
- Preview tabs replaced on navigation (unless dirty or has runState)
- Ctrl+S saves active tab (type-aware dispatch)

### Variable System
- Pattern: `{{variable_key}}` with optional whitespace (`{{ key }}` also works)
- Sources: environment variables (higher priority) + collection variables (lower priority)
- Visual: env vars = blue (accent-primary), collection vars = orange (accent-warning)
- `VariablePopoverProvider` at App level handles hover/edit for all inputs
- `EnvVariableInput` — single-line input with overlay highlighting + autocomplete
- `envVariableExtension.js` — CodeMirror plugin for JSON editor highlighting + autocomplete + hover
- Substitution at runtime in execution hooks with `\{\{\s*key\s*\}\}` regex
- `pm.environment.get/set` and `pm.collectionVariables.get/set` in scripts
- JSON objects supported: stored as stringified JSON, parsed on `.get()`

### Workflow Pattern
- Workflows belong to root collections (collection_id, not workspace_id)
- Steps are request ID references (no duplication)
- Sequential execution with stop-on-failure
- Root collection pre/post scripts run once (before first step, after last)
- Request-level scripts run per step
- Run state persisted in tab for tab-switch survival
- Dirty tab request data used over DB version

### CSS Pattern
- CSS variables for all colors/spacing (light/dark themes via `[data-theme]`)
- Feature-specific CSS in `src/styles/` (workflow-editor.css, environment-editor.css, etc.)
- Global styles in `App.css`
- Reuse existing classes: `.response-toolbar`, `.response-tabs`, `.btn-primary`, `.btn-icon`, `.request-menu`

### Virtualized JSON Tree (Response viewer, GH-70)
- `src/utils/jsonTree.js` is the pure model: `buildJsonTree(value)` builds a flat preorder node table iteratively (`id = JSON.stringify(path)`, `end`, `isLast`, `childCount`); `flattenVisibleRows(tree, expansion, forcedIds)` derives the visible rows (`open | leaf | empty | close`); expansion state is `{ mode: 'expanded' | 'collapsed', overrides: Set<id> }` via `createExpansion` / `toggleNode` / `isNodeExpanded`
- `src/components/JsonTreeView.jsx` renders the rows with `@tanstack/react-virtual` (rows absolutely positioned, `measureElement` for wrapped strings, `paddingStart/End`); selectors `json-tree`, `json-tree-row[data-path|data-kind|data-expanded]`, `json-tree-arrow`, `json-tree-key`, `json-tree-value[data-type]`, `json-tree-count`, `json-tree-copy`
- Search hits are addressed by `{ id, kind: 'key' | 'value', ordinal }` (occurrence index within the raw text), never by DOM index — only mounted rows carry `<mark>`s. Under an active search the base mode is forced to expanded (parity with the old library remount), so `forcedIds` is unused by the viewer today
- Copy: each row's selectable text is a valid JSON line (real trailing commas; badges, ellipsis, array indices are `user-select: none`), so `normalizeCopiedJson` only tidies leaks and pretty-prints. The per-node copy button writes `nodeToJsonText(node)` directly
- `openTabs` persistence goes through `persistOpenTabs(localStorage, tabs)` (drops `response` largest-first on quota errors, never throws)

### Database Pattern
- All IDs are UUIDs
- Timestamps as Unix epoch integers (BIGINT)
- JSON as JSONB columns
- Row Level Security on all tables
- Helper functions: `can_edit()`, `get_user_workspace_ids()`, `is_workspace_member()`
- Per-user values pattern: base table + `_user_values` join table (environments, collection variables)

## Testing
- **Unit tests**: Vitest (`npm run test:unit` → `vitest run`), jsdom env, `vitest.config.js`. Specs live next to source as `*.test.js` under `src/` (e.g. `src/utils/cookies.test.js`). jsdom provides `localStorage` for store tests; `vi.useFakeTimers()` for time-dependent logic; `vi.resetModules()` + dynamic `import()` to test fresh store re-init from persisted state. Introduced in GH-44 (cookie jar).
- **E2E tests**: Playwright (`npm run test:e2e`), specs under `e2e/`. Run against a real backend — never mocked.

## Known Pitfalls
- CodeMirror internal CSS class names (`.ͼd` etc.) are unstable — use `HighlightStyle.define()` instead
- `overflow: hidden` on parent clips `position: fixed` children — use portals
- `useCallback` closures capture stale state — use refs for values checked in timeouts
- `{{var}}` in JSON body is not valid JSON — beautify/minify must use placeholder replacement
- Supabase RLS policies must drop old policies before recreating on schema changes
- Tab `runState` and `bottomPanelHeight` must be stripped from localStorage persistence
- A large `tab.response` body overflows the localStorage quota — the `openTabs` write must stay inside `persistOpenTabs`; a bare `localStorage.setItem` in an effect throws into the root ErrorBoundary
- TanStack Virtual memoizes measurements on option-callback identity — pass a `useCallback`-stable `getItemKey` (an inline arrow rebuilds all measurements every render; 30–60 ms at ~1M rows)
- Copy normalizers must be structure-anchored: rewrite only row shapes (`^`/`: ` before, `,?$` after), never free-floating substrings — a global `…` or `N items` replace corrupts string values; `user-select: none` on decorations is the primary mechanism
- Browser max scroll height (~33.5M px Chromium, ~17.9M px Firefox) bounds a 20 px-row virtual list to roughly 1.6M / 0.9M rows
- After swapping a dependency, clear `node_modules/.vite` before running the dev server/E2E — the dep-optimizer cache still references the removed package and the app fails to load
- Playwright wipes `test-results/` on every run (single-spec re-runs included) — copy screenshot evidence before follow-up runs; `test-results/.last-run.json` is tracked and always shows modified, exclude it from commits
- Windows clipboard read-back is CRLF — normalize (`\r\n` → `\n`) before multi-line equality assertions in E2E
