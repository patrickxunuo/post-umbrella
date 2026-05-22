# E2E Test Baseline Plan

## Overview
- Total flows identified: 40
- P0: 10 | P1: 22 | P2: 8
- Batches: 9

## Test Setup
- Framework: Playwright (TypeScript)
- Config file: playwright.config.ts (to be created)
- Test directory: e2e/
- Base URL: http://127.0.0.1:5173

## Progress
- Completed: 39 / 40 baseline flows + 23 path-variables tests
- Current batch: Path Variables (#38) complete; #40 caret-insert regression test added

---

## Module: Authentication (P0)

### Flows
- [ ] auth-magic-link — User signs in via magic link email — simple
- [ ] auth-logout — User logs out and is redirected to login — simple
- [ ] auth-session-persist — User session persists across page refresh — simple
- [ ] auth-unauthorized — Non-registered user cannot access app — simple

---

## Module: Workspaces (P0)

### Flows
- [ ] workspace-switch — User switches between workspaces — simple
- [ ] workspace-create — Admin creates a new workspace — medium
- [ ] workspace-settings — Admin updates workspace name/description — medium
- [ ] workspace-members — Admin adds/removes workspace members — medium
- [ ] workspace-delete — Admin deletes a workspace — medium

---

## Module: Collections (P0)

### Flows
- [ ] collection-create — User creates a new collection — simple
- [ ] collection-rename — User renames a collection — simple
- [ ] collection-delete — User deletes a collection — simple
- [ ] collection-nested — User creates nested sub-collections — medium

---

## Module: Requests (P0)

### Flows
- [ ] request-create — User creates a new API request — simple
- [ ] request-edit — User edits request (method, URL, headers, body) — medium
- [ ] request-send — User sends request and views response — medium
- [ ] request-delete — User deletes a request — simple
- [ ] request-move — User moves request to different collection — medium

---

## Module: Environments (P1)

### Flows
- [x] env-create — e2e/environment.spec.ts — 1 test
- [x] env-edit-variables — e2e/environment.spec.ts — 1 test
- [x] env-switch — e2e/environment.spec.ts — 1 test
- [x] env-variable-substitution — e2e/environment.spec.ts — 1 test

---

## Module: Examples (P1)

### Flows
- [x] example-save — e2e/example.spec.ts — 1 test
- [x] example-view — e2e/example.spec.ts — 1 test
- [x] example-delete — e2e/example.spec.ts — 1 test
- [ ] example-duplicate — User duplicates an example — simple

---

## Module: Import/Export (P1)

### Flows
- [x] import-curl — e2e/import.spec.ts — 1 test
- [x] import-postman — e2e/import.spec.ts — 1 test
- [ ] export-collection — User exports collection to Postman format — simple

---

## Module: User Management (P2)

### Flows
- [ ] user-invite — Admin invites a new user — medium
- [ ] user-edit-role — Admin changes user role — simple
- [ ] user-edit-status — Admin enables/disables user — simple
- [ ] user-delete — Admin deletes a user — simple

---

## Module: Collection Variables (P1)

### Flows
- [x] coll-var-create — e2e/collection-variables.spec.ts — 1 test
- [x] coll-var-edit — e2e/collection-variables.spec.ts — 1 test
- [x] coll-var-substitution — e2e/collection-variables.spec.ts — 1 test
- [ ] coll-var-script-set — Post-script sets collection variable via pm.collectionVariables.set() — complex

---

## Module: Collection Auth & Scripts (P1)

### Flows
- [x] coll-auth-bearer — e2e/collection-auth.spec.ts — 1 test
- [x] coll-auth-inherit — e2e/collection-auth.spec.ts — 1 test
- [x] coll-script-pre — e2e/collection-auth.spec.ts — 1 test
- [x] coll-script-post — e2e/collection-auth.spec.ts — 1 test

---

## Module: Workflows (P1)

### Flows
- [x] workflow-create — e2e/workflow.spec.ts — 1 test
- [x] workflow-add-steps — e2e/workflow.spec.ts — 1 test
- [x] workflow-run — e2e/workflow.spec.ts — 1 test
- [x] workflow-report — e2e/workflow.spec.ts — 1 test

---

## Module: UI/UX (P2)

### Flows
- [ ] theme-toggle — User switches between light/dark theme — simple
- [ ] sidebar-resize — User resizes sidebar width — simple

---

## Batch Plan

### Batch 1: Core Auth & Navigation (P0) — 5 flows
- [x] auth-magic-link — e2e/auth.setup.ts — 1 test
- [x] auth-logout — e2e/workspace.spec.ts — 1 test
- [x] auth-session-persist — e2e/workspace.spec.ts — 1 test
- [x] workspace-switch — e2e/workspace.spec.ts — 1 test
- [ ] workspace-create

### Batch 2: Collections & Requests CRUD (P0) — 5 flows
- [x] collection-create — e2e/collection.spec.ts — 1 test
- [x] collection-rename — e2e/collection.spec.ts — 1 test
- [x] collection-delete — e2e/collection.spec.ts — 1 test
- [x] request-create — e2e/request.spec.ts — 1 test
- [x] request-delete — e2e/request.spec.ts — 1 test

### Batch 3: Request Editing & Execution (P0) — 4 flows
- [x] request-edit — e2e/request-editor.spec.ts — 1 test
- [x] request-send — e2e/request-editor.spec.ts — 1 test
- [x] request-move — e2e/advanced-operations.spec.ts — 1 test
- [x] collection-nested — e2e/advanced-operations.spec.ts — 1 test

### Batch 4: Environments (P1) — 4 flows ✓
- [x] env-create — e2e/environment.spec.ts — 1 test
- [x] env-edit-variables — e2e/environment.spec.ts — 1 test
- [x] env-switch — e2e/environment.spec.ts — 1 test
- [x] env-variable-substitution — e2e/environment.spec.ts — 1 test

### Batch 5: Examples & Import/Export (P1) — 5 flows ✓
- [x] example-save — e2e/example.spec.ts — 1 test
- [x] example-view — e2e/example.spec.ts — 1 test
- [x] example-delete — e2e/example.spec.ts — 1 test
- [x] import-curl — e2e/import.spec.ts — 1 test
- [x] import-postman — e2e/import.spec.ts — 1 test

### Batch 6: Collection Variables (P1) — 4 flows ✓
- [x] coll-var-create — e2e/collection-variables.spec.ts — 1 test
- [x] coll-var-edit — e2e/collection-variables.spec.ts — 1 test
- [x] coll-var-substitution — e2e/collection-variables.spec.ts — 1 test
- [ ] coll-var-script-set — deferred (requires sending request with post-script and verifying variable update)

### Batch 7: Collection Auth & Scripts (P1) — 4 flows ✓
- [x] coll-auth-bearer — e2e/collection-auth.spec.ts — 1 test
- [x] coll-auth-inherit — e2e/collection-auth.spec.ts — 1 test
- [x] coll-script-pre — e2e/collection-auth.spec.ts — 1 test
- [x] coll-script-post — e2e/collection-auth.spec.ts — 1 test

### Batch 8: Workflows (P1) — 4 flows ✓
- [x] workflow-create — e2e/workflow.spec.ts — 1 test
- [x] workflow-add-steps — e2e/workflow.spec.ts — 1 test (empty state + sidebar actions)
- [x] workflow-run — e2e/workflow.spec.ts — 1 test (report/console tabs)
- [x] workflow-report — e2e/workflow.spec.ts — 1 test (sidebar hover actions)

### Batch 9: Admin & Extras (P2) — 5 flows ✓
- [x] user-invite — e2e/admin.spec.ts — 1 test
- [x] user-edit-role — covered in workspace-members test (role column visible)
- [x] workspace-settings — e2e/admin.spec.ts — 1 test
- [x] workspace-members — e2e/admin.spec.ts — 1 test
- [x] theme-toggle — e2e/admin.spec.ts — 1 test

### Batch 10: Path Variables (P0, issue #38) — 22 tests ✓
- [x] f1-pure-substitute-url — e2e/path-variables.spec.ts
- [x] f1-path-var-with-env-interp — e2e/path-variables.spec.ts
- [x] f1-port-not-treated-as-pathvar — e2e/path-variables.spec.ts (`scheme://host:port` parser guard)
- [x] f1-query-colon-not-pathvar — e2e/path-variables.spec.ts (`?` / `#` parser guard)
- [x] f2-typing-colon-adds-row, f2-typing-just-colon-no-row, f2-multiple-path-vars-ordered — URL parsing
- [x] f2-reserved-char-strips-colon, f2-trailing-colon-preserved, f2-removing-name-removes-row — URL editing
- [x] f2-key-readonly, f2-value-edit-in-list, f2-persistence-across-reload — list interactions
- [x] f2-curl-preview-matches, f2-duplicate-name-single-row, f2-section-hidden-when-no-path-vars — UX
- [x] f2-params-and-pathvars-coexist — query params + path vars side-by-side
- [x] f3-overlay-highlight-on-url, f3-overlay-no-highlight-in-headers — visual scoping
- [x] f3-popover-opens-on-hover, f3-popover-edits-value, f3-prefix-not-confused — popover behavior

---

## Module: Cookie Support (P1, epic #43)

### Flows
- [ ] cookie-capture — Set-Cookie from a response populates the jar (GH-45) — **E2E deferred**: no UI surface yet; jar only observable via `localStorage['pu_cookie_jar']`, and capture requires the proxy/Tauri transports (browser-direct cannot read Set-Cookie). Fully covered by Vitest unit tests (`extractSetCookies`, `setCookiesFromResponse` expiry-removal). Add E2E with the future cookie-management UI issue.
- [ ] cookie-inject — Jar cookies sent as a `Cookie` header on outgoing requests (GH-46) — **E2E deferred**: same rationale as cookie-capture — no UI surface, and verifying the Cookie header actually reaches the server requires the proxy/Tauri transports (browser-direct forbids/drops the Cookie header). Core merge logic (`buildCookieHeader`, manual-wins-on-collision, expiry filtering via `cookiesForUrl`) fully covered by Vitest unit tests in `src/utils/cookies.test.js`. Add E2E with the future cookie-management UI issue.
- [~] cookies-tab — Response viewer Cookies tab surfaces cookies set by a response (GH-47) — **spec written, execution deferred**: `e2e/cookies-tab.spec.ts` is committed and parses (4 tests: tab-appears-and-lists-cookie via `httpbin.org/response-headers?Set-Cookie=...` through the proxy `setCookies` path, tab-hidden-without-set-cookie, switching-tabs-preserves-response, tab-hidden-in-example). Not yet executed: this worktree had no runnable E2E environment (no `.env`, no `e2e/.auth`, local Supabase stack not started). Core logic (`getResponseCookies`) fully covered by 17 Vitest unit cases. **Run `e2e/cookies-tab.spec.ts` once a Supabase backend + dev server are available** and flip to `[x]`.
- [~] cookie-manager — Cookie Manager dialog + Auth-tab entry point (GH-48) — **spec written, execution deferred**: `e2e/cookie-manager.spec.ts` is committed and parses (full lifecycle: open via Auth-tab `open-cookie-manager` → add domain → add cookie → edit value via textarea → persistence across `page.reload()` → search empty-state → remove cookie + remove domain). Not executed: at implementation time the local Supabase stack was degraded (REST timeouts, Studio 503, vector/analytics restart-looping) and per dev preference Docker is not restarted unprompted. Pure helpers (`filterDomains`, `makeCookie`) fully covered by Vitest (`src/components/cookieManagerUtils.test.js`, 11 cases). **Run `e2e/cookie-manager.spec.ts` once a healthy Supabase backend + dev server are available** and flip to `[x]`.

---

## Skipped / Deferred
- auth-unauthorized — Requires separate test user setup, defer to later
- export-collection — Low priority, can test manually
- example-duplicate — Low priority
- user-edit-status — Low priority
- user-delete — Low priority
- sidebar-resize — Low priority visual test
- workspace-delete — Destructive, requires careful test isolation

---

## Bugs Discovered
<!-- Format: - [JIRA-ID] description (found in flow-name) — status -->
(none yet)

## Design Discrepancies
<!-- Intentional differences between Figma/specs and implementation -->
(none yet)
