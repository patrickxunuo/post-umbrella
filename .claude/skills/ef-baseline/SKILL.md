---
name: ef-baseline
description: Retrofit E2E test coverage onto existing projects — plan, execute in batches, track progress
disable-model-invocation: true
argument-hint: [plan|status|next|flow-name]
---

# Baseline E2E Tests: $ARGUMENTS

Retrofit E2E tests onto an existing project that has no automated test coverage. Tests are driven by **requirements and designs** (Figma, specs), not just current code. When behavior differs from intent, triage with the developer and log bugs to Jira.

## Active Task Tracking

**At the start of each step**, update `memory-bank/activeTask.md` with current progress. This file survives context compaction and allows you to resume if you lose context.

Format:
```markdown
# Active Task
- Skill: /ef-baseline
- Skill file: .claude/skills/ef-baseline/SKILL.md
- Action: [plan / next / flow-name]
- Current step: [Step N: name]
- Waiting for: [developer / nothing]

## Completed
- [x] Step 1: Context read
- [x] Step 2: Dev environment running
...

## Key Artifacts
- Test baseline: memory-bank/testBaseline.md
- Current flow: [flow-name]
- Test file: [path]
```

**When the workflow completes** (plan confirmed, or flow tests all pass and progress updated), delete `memory-bank/activeTask.md`.

## Route by Action

- `plan` → go to **Plan Test Coverage**
- `status` → go to **Show Progress**
- `next` → go to **Write Tests for Flow** (auto-pick next uncovered flow)
- Any other argument → treat as a flow name, go to **Write Tests for Flow**

---

## Plan Test Coverage

Scan the entire application and create an inventory of all user flows that need E2E testing.

### Step 1: Read Context

0. **Guard**: If `memory-bank/index.md` does not exist, STOP — tell the developer: "Memory bank not initialized. Run `/ef-context` first, then come back to `/ef-baseline`."
1. Read `memory-bank/index.md` — find all relevant context files
2. Read `memory-bank/techContext.md` — tech stack, frontend framework, existing test setup
3. Read `memory-bank/projectBrief.md` — business context and requirements
4. Read `memory-bank/devSetup.md` if it exists — understand how to run the app
5. Read `memory-bank/testBaseline.md` if it exists — check if a plan already exists (if so, ask the developer if they want to re-plan or just continue)

### Step 2: Ensure Dev Environment is Running

1. Check `memory-bank/devSetup.md` for the startup script filename, or look for `dev-start.*` at project root
2. If found → run the script
3. If not → run `/ef-dev explore` first to discover, record, and generate the startup script
4. If services are already running — skip

The app must be running so you can observe its actual structure and behavior.

### Step 3: Understand Requirements First

**Tests should be driven by requirements, not by existing code.** Before scanning code, gather the intended behavior from design and documentation sources:

**Figma designs (if available):**
- Check if `techContext.md` lists Figma URLs or the project has Figma references
- Use Figma MCP tools (`get_design_context`, `get_screenshot`) to review the intended UI for each major page/flow
- Note differences between design and current implementation — these may be bugs or intentional deviations
- The design tells you WHAT the feature should do; the code tells you what it ACTUALLY does

**Confluence / documentation (if available):**
- Search for PRDs, feature specs, user stories that define requirements
- These are the source of truth for "is this a bug or intentional?"

**Current UI (via Playwright):**
- Use Playwright to navigate the running app and take screenshots of each major page
- Compare screenshots against Figma designs to spot visual discrepancies
- This gives you a real-time view of what users actually see

**When design and implementation differ:**
- Note each discrepancy — these become investigation items during testing
- Do NOT assume the code is correct; do NOT assume the design is current
- Mark them for discussion with the developer during the CHECKPOINT

### Step 4: Scan the Application

Discover all user-facing flows by examining both the requirements (Step 3) and the codebase:

**Routes & Pages:**
- Frontend router config (React Router, Next.js pages/app, Vue Router, etc.)
- Backend route definitions (REST endpoints, GraphQL schema)
- Navigation menus, sidebars, breadcrumbs — reveal the app's structure

**Auth & Access:**
- Login/register/logout flows
- Role-based access — which pages/features are restricted
- Session/token handling

**Core CRUD Flows:**
- For each entity (users, orders, products, etc.): create, read, update, delete
- List views with filtering, sorting, pagination
- Detail views

**Critical Business Flows:**
- Multi-step workflows (checkout, onboarding, approval chains)
- Payment or financial operations
- Data import/export
- Notifications, emails

**Integration Points:**
- Third-party service interactions visible to users
- File uploads/downloads
- Real-time features (WebSocket, SSE)

### Step 5: Organize into Modules

Group discovered flows into logical modules. For each module, list its flows:

```markdown
## Module: [Module Name]
Priority: P0 / P1 / P2

### Flows
- [ ] [flow-name] — [1-line description] — [complexity: simple / medium / complex]
- [ ] [flow-name] — [1-line description] — [complexity]
```

**Priority criteria:**
- **P0** — Core business flows. If these break, the app is unusable (auth, main CRUD, payment)
- **P1** — Important but not critical. Users can work around breakage (filters, bulk ops, settings)
- **P2** — Nice to have. Edge features, admin-only, rarely used

**Complexity criteria:**
- **Simple** — 1-2 pages, no conditional logic, straightforward assertions
- **Medium** — Multi-step flow, some state management, moderate assertions
- **Complex** — Multi-page workflow, requires specific test data setup, many assertions

### Step 6: Create Batch Plan

Group flows into batches of 3-5 flows each, considering:
- Each batch should take roughly one session to complete
- Group related flows into the same batch (e.g., all auth flows together)
- P0 flows go into the earliest batches
- Put simple flows first within a batch — build momentum and catch setup issues early

### Step 7: Write testBaseline.md

Create `memory-bank/testBaseline.md`:

```markdown
# E2E Test Baseline Plan

## Overview
- Total flows identified: X
- P0: X | P1: X | P2: X
- Batches: X

## Test Setup
- Framework: [Playwright / etc.]
- Config file: [path]
- Test directory: [path]
- Base URL: [from devSetup.md]

## Progress
- Completed: 0 / X flows
- Current batch: Batch 1

## Batch 1: [Theme] (P0)
- [ ] [flow-name] — [description]
- [ ] [flow-name] — [description]
- [ ] [flow-name] — [description]

## Batch 2: [Theme] (P0)
- [ ] [flow-name] — [description]
- [ ] [flow-name] — [description]

## Batch 3: [Theme] (P1)
...

## Skipped / Deferred
(flows intentionally skipped with reasons)

## Bugs Discovered
<!-- Format: - [JIRA-ID] description (found in flow-name) — status -->
(none yet)

## Design Discrepancies
<!-- Intentional differences between Figma/specs and implementation -->
(none yet)
```

### Step 8: Ensure Branch Isolation

Check `memory-bank/techContext.md` for repo structure, then suggest worktree per Git Workflow rules in CLAUDE.md:

- **Single repo**: `git worktree add ../[project]-baseline baseline/e2e`
- **Multi-repo (wrapper)**: Create worktree inside the wrapper for repos that need baseline changes:
  - `cd frontend && git worktree add ../frontend-baseline baseline/e2e` (E2E tests + `data-testid`)
  - Backend worktree only if adding API tests

Record the worktree path in `testBaseline.md` so future sessions know where to work.
If the developer declines, continue on the current branch.

### Step 9: Setup Playwright (if needed)

If the project has no E2E test setup:

1. Install Playwright — always use TypeScript regardless of backend language
2. Create `playwright.config.ts` with:
   - Base URL from `devSetup.md`
   - Reasonable timeouts
   - Screenshot on failure
   - HTML reporter
3. Create test directory structure
4. Create a smoke test that just loads the home page — verify Playwright works
5. Run the smoke test — it MUST PASS
6. Update `memory-bank/techContext.md` with the new test setup

## CHECKPOINT

**STOP HERE.** Show the plan to the developer:
- Total flows discovered
- Module breakdown with priorities
- Batch plan
- Ask: "Review the plan. You can add/remove flows, change priorities, or adjust batches. Confirm when ready and I'll start with Batch 1."

Wait for developer confirmation before proceeding.

After confirmation, update `memory-bank/index.md` to include `testBaseline.md`.

---

## Write Tests for Flow

Write E2E tests for a specific flow or the next uncovered flow.

### Step 1: Read Context
> **Update `activeTask.md`**: Skill = /ef-baseline, Action = write tests, Current step = Step 1, Flow = [flow-name]

1. Read `memory-bank/testBaseline.md` — find the flow, understand scope
2. Read `memory-bank/devSetup.md` — know how to start the app
3. Read `memory-bank/techContext.md` — test framework and config
4. Read `memory-bank/systemPatterns.md` — code conventions

If `$ARGUMENTS` is `next` → find the first unchecked `- [ ]` flow in the current batch.
If `$ARGUMENTS` matches a flow name → process that specific flow.
If no testBaseline.md exists → tell the developer to run `/ef-baseline plan` first.

### Step 2: Ensure Dev Environment is Running

1. Check `memory-bank/devSetup.md` for the startup script filename, or look for `dev-start.*` at project root
2. If found → run the script
3. If not → run `/ef-dev explore` first to discover, record, and generate the startup script
4. If services are already running — skip

### Step 3: Understand the Flow
> **Update `activeTask.md`**: Current step = Step 3

Before writing tests, understand the **intended behavior** — not just the current implementation:

1. **Check Figma designs** (if available) — use Figma MCP tools to get the design for pages/components in this flow. The design shows the INTENDED user experience.
2. **Check requirements docs** — search Confluence/Jira for specs related to this flow
3. **Read the source code** for the relevant pages/components/API endpoints
4. **Use Playwright to screenshot the current UI** — compare against Figma designs
5. **Identify test scenarios** based on requirements first, then supplement from code:
   - Happy path (main success scenario — as defined by requirements/design)
   - Key error states (form validation, unauthorized access, empty states)
   - Only include edge cases if they are obviously critical
6. **Identify test data requirements** — what data must exist for the flow to work
7. **Check for existing `data-testid` attributes** — note which elements have them and which don't
8. **Note discrepancies** between design/requirements and current implementation — these will be investigated in Step 5

### Step 4: Write E2E Test
> **Update `activeTask.md`**: Current step = Step 4

Create test file following the project's test directory structure.

**Rules for baseline tests:**
- Test file name: `[flow-name].spec.ts`
- Each scenario is a separate `test()` block
- Selectors priority: `data-testid` > role/label > text content > CSS class (last resort)
- Add `await page.screenshot()` at key assertion points
- Tests must be **independent** — each test sets up its own state, no test depends on another
- Keep assertions focused on **user-visible behavior**, not implementation details
- If the flow requires auth, create a shared auth setup (storageState pattern in Playwright)
- **NEVER mock or stub API calls** — no `page.route()`, no mock service workers, no fake responses. E2E tests MUST hit the real running backend. If the backend is not running, start it first — do not work around it with mocks.

**Test structure:**
```typescript
import { test, expect } from '@playwright/test';

test.describe('[Flow Name]', () => {
  // Setup: test data, auth state, etc.

  test('[happy path description]', async ({ page }) => {
    // Navigate
    // Interact
    // Assert visible outcome
  });

  test('[error state description]', async ({ page }) => {
    // Navigate
    // Trigger error condition
    // Assert error is shown to user
  });
});
```

### Step 5: Run and Triage
> **Update `activeTask.md`**: Current step = Step 5

1. Run the test: `npx playwright test [test-file]`
2. **Open the HTML test report** (e.g., `npx playwright show-report`) so the developer can see the results visually
3. If all tests pass → done, go to Step 6
4. If a test fails, determine the cause:

**Case A: Wrong test** (bad selector, timing issue, wrong assumption about UI structure)
→ Fix the test. Re-run.

**Case B: Behavior differs from what you expected**
This is the critical decision point. Do NOT silently adjust the test. Instead:

1. **Show the discrepancy to the developer:**
   > "In the [flow-name] flow, I expected [X] based on [Figma design / requirement doc / common UX practice], but the app actually does [Y]. Is this intentional or a bug?"
2. **Provide evidence** — screenshot from Playwright, screenshot from Figma if available, link to requirement doc
3. **Wait for the developer's answer:**

   - **"It's intentional"** → write the test to match current behavior, add a comment explaining why it differs from design: `// NOTE: differs from Figma design — [reason per developer]`
   - **"It's a bug"** → proceed to bug logging below
   - **"Not sure, let me check"** → pause this flow, mark it as `- [?] flow-name — pending triage` in testBaseline.md, move to the next flow

**Case C: Confirmed bug**

1. Log the bug to Jira (if configured in `techContext.md`):
   - Title: `[BUG] [flow-name]: [short description]`
   - Description: what was expected (from design/requirements) vs what actually happens
   - Include screenshots (Playwright actual vs Figma expected)
   - Priority: based on business impact
   - Label: `baseline-audit`
2. Record in `testBaseline.md` under **Bugs Discovered**: `- [JIRA-ID] [description] (found in [flow-name])`
3. Write the test in one of two ways (ask developer which they prefer):
   - **Option A**: Test matches current (buggy) behavior, marked with `// BUG: JIRA-ID — [description]`. Test will break when the bug is fixed (which is good — it signals the fix).
   - **Option B**: Test asserts the correct behavior but is marked `test.fixme()` so it's skipped until the bug is fixed.
4. Continue with the remaining tests in this flow

Run until all non-fixme tests pass.

### Step 6: Add Missing Test Selectors
> **Update `activeTask.md`**: Current step = Step 6

If the flow's UI lacks `data-testid` attributes and you had to use fragile selectors:

1. List the components that need `data-testid` attributes
2. Add the attributes to the source code
3. Update the tests to use `data-testid` selectors
4. Re-run tests to confirm they still pass

### Step 7: Update Progress
> **Update `activeTask.md`**: Current step = Step 7

Update `memory-bank/testBaseline.md`:
1. Check off completed flow: `- [x] [flow-name] — [test-file-path] — X tests`
2. Update the progress counter (`Completed: N / Total`)
3. Record any bugs discovered in the **Bugs Discovered** section
4. If the current batch is complete, update "Current batch" to the next one

Show summary:
```
## Baseline Progress

Flow: [flow-name]
Tests written: X
Tests passing: X/X
Bugs found: [list or "none"]
File: [test-file-path]

Overall: X/Y flows covered (Z%)
Current batch: Batch N — [M/K flows done]
Next: run /ef-baseline next
```

### Step 8: Continue or Stop
> **Delete `memory-bank/activeTask.md`** — this flow is done.

After showing the summary:
- If there are more flows in the current batch → ask: "Continue with the next flow [flow-name]?"
- If the batch is complete → say: "Batch N complete. Run `/ef-baseline next` in a new session to start Batch N+1."
- If all batches are complete → say: "Baseline coverage complete! X flows covered with Y tests. The project now has a regression safety net."

If the developer confirms to continue, go back to **Step 1** with the next flow.

---

## Show Progress

Quick status check on baseline test coverage.

1. Read `memory-bank/testBaseline.md`
2. If it doesn't exist → "No baseline plan yet. Run `/ef-baseline plan` first."
3. Show:

```
## Baseline Test Coverage

Total: X/Y flows covered (Z%)

### By Priority
- P0: X/Y covered
- P1: X/Y covered
- P2: X/Y covered

### By Module
- [Module]: X/Y flows ██████░░░░ 60%
- [Module]: X/Y flows ██████████ 100%
- [Module]: X/Y flows ░░░░░░░░░░ 0%

### Current Batch: Batch N — [Theme]
- [x] flow-1
- [x] flow-2
- [ ] flow-3 ← next
- [ ] flow-4

### Bugs Discovered
- [bug description] (found in [flow])

### Next Action
Run `/ef-baseline next` to continue with [flow-3]
```

---

## General Rules

- **Requirements first, code second.** Write tests based on what the feature SHOULD do (from designs and specs), not just what the code currently does. Discrepancies between intent and implementation are bugs to triage, not tests to silently adjust.
- **Never mock APIs in E2E tests.** No `page.route()`, no MSW, no fake responses. E2E tests run against the real backend — start it locally before testing. If the backend is down, fix it, don't mock around it.
- **Never silently accept unexpected behavior.** If the app does something different from the design or requirements, STOP and discuss with the developer. Don't assume the code is right.
- **PASS is the only acceptable outcome for non-bug tests.** If a test fails, either fix the test (wrong assumption) or triage the behavior (potential bug). Use `test.fixme()` for confirmed bugs awaiting fixes.
- **Keep tests maintainable.** Prefer fewer robust tests over many brittle ones. One solid happy-path test per flow is better than five flaky ones.
- **Don't boil the ocean.** Each session should complete 3-5 flows. Batch boundaries are natural stopping points.
- **Progress is persistent.** `testBaseline.md` tracks everything across sessions. Any session can pick up where the last one left off.
- **Bugs are valuable findings.** Baseline testing is also a quality audit. Every bug discovered and logged to Jira is value delivered before a single line of new code is written.
- **`data-testid` is an investment.** Adding test selectors during baseline is extra work now but saves maintenance pain later.
