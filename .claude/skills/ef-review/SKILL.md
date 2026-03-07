---
name: ef-review
description: Review current changes for code quality, conventions, known pitfalls, and test coverage
disable-model-invocation: true
---

# Review Changes

Review all current changes before submitting a PR. Check against project conventions and test requirements.

## Important: Clean Context Required

**This review MUST be run in a fresh conversation session** — NOT in the same session that wrote the code. The best practice is to open a new session from the feature worktree directory (e.g., `cd ../project-feat-xxx && claude`).

If you are reviewing code that you just implemented in this same conversation, STOP and tell the developer:

> "I wrote this code in the current session. For an objective review, please start a new Claude Code session and run `/ef-review` there. A reviewer should not review their own work in the same context."

If the developer insists on continuing in the same session, proceed but:
- Adopt the mindset of a **skeptical external reviewer**
- You may use conversation history for context (understanding WHY decisions were made), but do NOT use it to justify or defend the code
- Judge the code against project conventions, acceptance spec, and best practices — not against your own reasoning from earlier
- Actively look for problems — assume the code has bugs until proven otherwise

## Step 1: Understand Context

Build context ONLY from project files — not from conversation history.

1. Read `memory-bank/index.md` — find all relevant context files
2. Read `memory-bank/techContext.md` — tech stack and architecture
3. Read `memory-bank/systemPatterns.md` — code conventions and patterns
4. Read `memory-bank/devSetup.md` if it exists — know how to start the dev environment for running tests
5. Read any topic-specific memory files that contain patterns or pitfalls (listed in index.md)
6. If Jira is configured in `techContext.md`, look up the ticket(s) related to the changed code — check acceptance criteria and requirements to verify the implementation matches what was specified

## Step 2: Gather Changes

Run `git diff` (staged + unstaged) and `git diff --cached` to see all pending changes.
List all modified and new files.

## Step 3: Convention Check

For each changed file, verify:

- [ ] **Naming**: Files, classes, functions, variables follow conventions in `systemPatterns.md`
- [ ] **Structure**: Code is in the correct directory/package per project structure
- [ ] **Patterns**: Implementation follows established patterns (e.g., service layer, repository pattern, error handling)
- [ ] **No hardcoded values**: Config values use environment variables or config files
- [ ] **No secrets**: No API keys, passwords, tokens, or credentials in code

## Step 4: Knowledge Check

Cross-reference changes against known patterns and pitfalls from memory-bank topic files:

- [ ] Are any known pitfalls present in the new code?
- [ ] Does the business logic match documented patterns?
- [ ] Are edge cases from past projects handled?

For each issue found, explain:
- What the issue is
- Why it's a problem (reference the memory file)
- How to fix it

## Step 5: Test Coverage Check

### Ensure Dev Environment is Running
Before running tests, make sure the required services are up:
1. Check `memory-bank/devSetup.md` for the startup script filename, or look for `dev-start.*` at project root
2. If found → run the script
3. If not → run `/ef-dev explore` first to discover, record, and generate the startup script
4. If services are already running (check health endpoints or ports) — skip startup

### Run Tests
1. Find the acceptance spec in `acceptance/` related to the changed feature
2. Verify:
   - [ ] All acceptance test IDs have corresponding test functions
   - [ ] All API tests are passing
   - [ ] All E2E tests are passing
   - [ ] No existing tests were broken (run full test suite)
3. If no acceptance spec exists for the changed code, flag it:
   - "No acceptance spec found for [feature]. Run `/ef-implement [feature]` to create one."

## Step 6: Security Quick Check

- [ ] User input is validated/sanitized at API boundaries
- [ ] Authentication/authorization checks are in place for protected endpoints
- [ ] SQL queries use parameterized statements (no string concatenation)
- [ ] No sensitive data in logs or error messages
- [ ] File uploads (if any) are validated for type and size

## Step 7: Output Review Report

Present findings in this format:

```
## Code Review Report

### Summary
- Files changed: X
- Issues found: X (Y critical, Z minor)

### Critical Issues
[Must fix before PR]
- [file:line] — [issue description] — [how to fix]

### Warnings
[Should fix, but not blocking]
- [file:line] — [issue description] — [suggestion]

### Suggestions
[Optional improvements]
- [file:line] — [suggestion]

### Pitfall Matches
[From project memory]
- [pitfall name] — [where it appears] — [recommended fix]

### Test Status
- Acceptance spec: [exists / missing]
- API tests: X/X passing
- E2E tests: X/X passing
- Regression: [none / list broken tests]

### Verdict
Ready for PR / Fix critical issues first
```

### Next Steps by Verdict

**Ready for PR:**
> "Code looks good. You can create a PR now. If you used a worktree, remember to clean up after merge: `git worktree remove ../[name]`."

**Fix critical issues first — Requirements problem:**
Issues like missing acceptance criteria, wrong business logic, feature doesn't match spec, or scope gap.
> "These issues are requirements-level problems, not just code fixes. Re-run `/ef-plan` to revise the module breakdown, or re-run `/ef-implement [feature]` from CHECKPOINT 1 to rework the acceptance spec."

**Fix critical issues first — Development problem:**
Issues like convention violations, security flaws, missing tests, bad error handling, or code quality problems.
> "Fix the issues listed above, then run `/ef-review` again in a new session to verify."

## Step 8: Update Memory

After review is complete, run `/ef-context after-review` to record any new patterns, convention gaps, or pitfalls discovered during the review.
