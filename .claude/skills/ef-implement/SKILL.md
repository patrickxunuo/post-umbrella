---
name: ef-implement
description: Full TDD workflow - acceptance spec, tests, then implementation with pause points
disable-model-invocation: true
argument-hint: [feature-name]
---

# Implement Feature: $ARGUMENTS

Execute the full TDD development workflow. Follow every step in order. Do NOT skip any step.

## Active Task Tracking

**At the start of each step**, update `memory-bank/activeTask.md` with current progress. This file survives context compaction and allows you to resume if you lose context.

Format:
```markdown
# Active Task
- Skill: /ef-implement
- Skill file: .claude/skills/ef-implement/SKILL.md
- Feature: $ARGUMENTS
- Current step: [Step N: name]
- Waiting for: [developer / nothing]

## Completed
- [x] Step 0: Branch isolation
- [x] Step 1: Context read
- [x] Step 2: Acceptance spec → acceptance/$ARGUMENTS.md
...

## Key Artifacts
- Acceptance spec: acceptance/$ARGUMENTS.md
- API test file: [path]
- E2E test file: [path]
- Jira ticket: [ID or N/A]
```

**When the workflow completes** (Step 8 done), delete `memory-bank/activeTask.md`.

## Step 0: Ensure Branch Isolation
> **Update `activeTask.md`**: Current step = Step 0

Check `memory-bank/techContext.md` for repo structure, then suggest worktree per Git Workflow rules in CLAUDE.md:

- **Single repo**: `git worktree add ../[project]-$ARGUMENTS feat/$ARGUMENTS`
- **Multi-repo (wrapper)**: Create worktree inside the wrapper for each repo that will be modified:
  - `cd frontend && git worktree add ../frontend-$ARGUMENTS feat/$ARGUMENTS`
  - `cd backend && git worktree add ../backend-$ARGUMENTS feat/$ARGUMENTS`
  - Use the same ticket ID / feature name across repos for unified naming

If the developer declines, continue — isolation is recommended, not mandatory.

## Step 1: Understand Context
> **Update `activeTask.md`**: Current step = Step 1

0. **Guard**: If `memory-bank/index.md` does not exist, STOP — tell the developer: "Memory bank not initialized. Run `/ef-context` first, then come back to `/ef-implement`."
1. Read `memory-bank/index.md` — find all relevant context files
2. Read `memory-bank/projectBrief.md` — business context
3. Read `memory-bank/techContext.md` — tech stack (determines which test frameworks to use)
4. Read `memory-bank/systemPatterns.md` — code conventions
5. Read `memory-bank/devSetup.md` if it exists — know how to start/stop the dev environment
6. Read any topic-specific memory files relevant to this feature (listed in index.md)
7. Check if there is a module plan that includes this feature (look in `acceptance/` or recent conversation)
8. If Jira is configured in `techContext.md` and the feature references a ticket (e.g., PROJ-123), look it up via MCP tools — pull description, acceptance criteria, and linked issues
9. If Confluence is configured, search for design docs or specs related to this feature
10. If a Jira ticket was found, transition it to **"In Progress"**

## Step 2: Generate Acceptance Spec
> **Update `activeTask.md`**: Current step = Step 2

Create file `acceptance/$ARGUMENTS.md` with this structure:

```markdown
# [Feature Name] - Acceptance Criteria

## Description (client-readable)
[1-3 sentences in plain language describing what this feature does]

## API Acceptance Tests
| ID | Scenario | Precondition | Request | Expected Response |
|----|----------|-------------|---------|------------------|
| API-001 | [happy path] | [setup] | [method + path + body] | [status + key fields] |
| API-002 | [validation error] | [setup] | [request] | [status + error] |
| API-003 | [auth failure] | [setup] | [request] | [401/403] |
| ... | ... | ... | ... | ... |

## Frontend Acceptance Tests
| ID | User Action | Expected Result |
|----|------------|----------------|
| FE-001 | [core happy path flow] | [what user sees] |
| FE-002 | [main error state] | [what user sees] |
| ... | ... | ... |

## Test Status
- [ ] API-001: Pending
- [ ] FE-001: Pending
```

Guidelines:
- API tests: 5-10 per endpoint. Cover happy path, validation, auth, edge cases.
- Frontend tests: 2-3 per feature. Only core user flow + main error state.
- Think from the client's perspective: "What proves this feature works correctly?"

## CHECKPOINT 1
> **Update `activeTask.md`**: Current step = CHECKPOINT 1, Waiting for = developer

**STOP HERE.** Show the acceptance spec to the developer.
Say: "Here is the acceptance spec for [feature]. Please review. You can add, modify, or remove any test cases. Confirm when ready and I'll generate the test code."

Wait for developer confirmation before proceeding.

## Step 3: Generate Test Code
> **Update `activeTask.md`**: Current step = Step 3, Waiting for = nothing

After developer confirms, generate test code based on the tech stack defined in `memory-bank/techContext.md`.

### Multi-Repo Check
Before creating any test files, check `memory-bank/techContext.md` for the project's repository structure:
- **Single repo**: Create all tests in the current project
- **Multi-repo**: Each test type MUST be placed in the repo where it belongs:
  - API/backend tests → backend repo
  - E2E/frontend tests → frontend repo
  - If the target repo is not the current working directory, **tell the developer** which repo needs the tests and provide the test code. Do NOT create test files in the wrong repo.

### API Tests
- Create test file in the **backend project's** test directory
- One test function per API acceptance test ID (name it clearly: `test_API001_...` or `void API001_...`)
- Set up test data in before/setup hooks
- Assert both response status and body content
- Assert side effects where applicable (e.g., stock reduced, record created)

### E2E Tests (Playwright)
- Create test file in the **frontend project's** e2e test directory
- One `test()` per frontend acceptance test ID
- Use `data-testid` attributes for element selection (note: implementation must add these)
- Add `await page.screenshot({ path: '...' })` at key steps
- Keep tests focused on user-visible behavior, not implementation details
- **NEVER mock or stub API calls** — no `page.route()`, no mock service workers, no fake responses. E2E tests MUST hit the real running backend. Start the backend locally before running tests.

### Ensure Dev Environment is Running
Before running any tests, make sure the required services are up:
1. Check `memory-bank/devSetup.md` for the startup script filename, or look for `dev-start.*` at project root
2. If found → run the script
3. If not → run `/ef-dev explore` first to discover, record, and generate the startup script
4. If services are already running (check health endpoints or ports) — skip startup

### Run Tests
Run all generated tests. They should ALL FAIL because implementation doesn't exist yet.
After tests finish, **open the HTML test report** (e.g., `npx playwright show-report`) so the developer can see the results visually.

If any test passes unexpectedly, investigate — the test might not be testing what it should.

If a test cannot be written or is fundamentally flawed (wrong assumption, impossible precondition, etc.), go back to CHECKPOINT 1 — revise the acceptance spec with the developer, then regenerate the affected tests.

## CHECKPOINT 2
> **Update `activeTask.md`**: Current step = CHECKPOINT 2, Waiting for = developer

**STOP HERE.** Show test results to the developer.
Say: "All X tests are failing as expected. Ready to implement. Shall I proceed?"

Wait for developer confirmation before proceeding.

## Step 4: Implement Backend
> **Update `activeTask.md`**: Current step = Step 4

Build the backend to make API tests pass:

- Ensure dev environment services are still running (database, etc.) — restart via the startup script (see `devSetup.md`) if needed
- Follow the code structure and conventions in `memory-bank/systemPatterns.md`
- Check relevant topic memory files for patterns and known pitfalls
- Generate unit tests alongside service layer code for complex business logic
- After implementation, restart the backend service, then run API tests. Fix until ALL PASS. **Open the test report** for the developer to review.
- **Multi-repo**: If the backend is in a different repo from where you're working, tell the developer which repo needs the changes and provide the code.

## Step 5: Implement Frontend
> **Update `activeTask.md`**: Current step = Step 5

Build the frontend to make E2E tests pass:

- Ensure dev environment services are still running (backend + database at minimum) — restart via the startup script (see `devSetup.md`) if needed
- Follow the component patterns in `memory-bank/systemPatterns.md`
- Add `data-testid` attributes matching the E2E test selectors
- After implementation, restart the frontend service, then run E2E tests. Fix until ALL PASS. **Open the test report** for the developer to review.
- **Multi-repo**: If the frontend is in a different repo from where you're working, tell the developer which repo needs the changes and provide the code.

## Step 6: Final Verification
> **Update `activeTask.md`**: Current step = Step 6

1. Ensure all dev environment services are running — restart via the startup script (see `devSetup.md`) if any went down during implementation
2. Run ALL tests (new + existing) to check for regressions
3. **Open the HTML test report** (e.g., `npx playwright show-report`) so the developer can review full results
4. If any existing test broke, fix it before proceeding
4. Update `acceptance/$ARGUMENTS.md`:
   - Mark all test IDs as passed: `- [x] API-001: PASS`
   - Add screenshot paths if generated

Show final summary to developer:
```
Feature: [name]
API Tests: X/X PASS
E2E Tests: X/X PASS
Regressions: None
Files created/modified: [list]
```

## Step 7: Update Jira (if configured)
> **Update `activeTask.md`**: Current step = Step 7

If a Jira ticket is associated with this feature:

1. Transition the ticket to **"Done"** (or the project's equivalent completion status)
2. Add a comment summarizing the implementation:
   - Test results (API: X/X, E2E: X/X)
   - Key files created/modified
   - Any notable decisions or trade-offs

## Step 8: Update Memory
> **Update `activeTask.md`**: Current step = Step 8

After feature is complete, run `/ef-context after-implement` to update the memory bank.

**After memory update completes, delete `memory-bank/activeTask.md`** — the workflow is done.

## Next Steps

Tell the developer:

1. **Review** — Open a new session and run `/ef-review` to check code quality before creating a PR.
2. **Next feature** — Check `memory-bank/progress.md` or the module plan for the next feature in the recommended development order.
3. **Worktree cleanup** — If you created a worktree in Step 0, after the PR is merged: `git worktree remove ../[worktree-name]`.
