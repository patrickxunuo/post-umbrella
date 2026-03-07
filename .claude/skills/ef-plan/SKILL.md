---
name: ef-plan
description: Break a module into features with priorities, dependencies, and acceptance direction
disable-model-invocation: true
argument-hint: [module-name]
---

# Plan Module: $ARGUMENTS

Break down this module into implementable features. Read project context first, then produce a structured plan.

## Step 1: Understand Context

0. **Guard**: If `memory-bank/index.md` does not exist, STOP — tell the developer: "Memory bank not initialized. Run `/ef-context` first, then come back to `/ef-plan`."
1. Read `memory-bank/index.md` — find all relevant context files
2. Read `memory-bank/projectBrief.md` — what is this project, who is the client, what problem are we solving
3. Read `memory-bank/techContext.md` — tech stack and architecture constraints
4. Check `memory-bank/progress.md` — what has already been built
5. Read any topic-specific memory files relevant to this module (listed in index.md)
6. If Jira is configured in `techContext.md`, search for existing epics and tickets related to "$ARGUMENTS" via MCP tools — pull in requirements, priorities, and acceptance criteria already defined there
7. If Confluence is configured, search for design docs or specs related to this module

## Step 2: Break Down Features

For the "$ARGUMENTS" module, identify all features needed. For each feature, provide:

1. **Feature name** — short, clear (e.g., "Order Creation", "Order List with Filters")
2. **Description** — 1-2 sentences of what it does
3. **Priority** — P0 (must have), P1 (should have), P2 (nice to have)
4. **Dependencies** — which other features must be built first
5. **Acceptance direction** — bullet points of what "done" looks like (these become input for `/ef-implement` later)

Use this format:

```markdown
# [Module Name] - Development Plan

## Features

### 1. [Feature Name] (P0)
**Description:** [what it does]
**Dependencies:** None / [other features]
**Acceptance direction:**
- [key behavior 1]
- [key behavior 2]
- [edge case to handle]
- [permission/auth requirement]

### 2. [Feature Name] (P0)
...
```

## Step 3: Suggest Development Order

Based on dependencies and priorities, suggest the order to implement features.

```markdown
## Recommended Development Order

1. [Feature] — no dependencies, other features depend on it
2. [Feature] — depends on #1
3. [Feature] — independent, can parallel with #2
...
```

## Step 4: Estimate Scope

Give a rough scope estimate:

```markdown
## Scope Summary

| Feature | API Endpoints | Pages | Estimated Complexity |
|---------|--------------|-------|---------------------|
| [name]  | [count]      | [count] | Low / Medium / High |
| ...     | ...          | ...   | ...                 |

Total features: X
Estimated sprints: Y (assuming Z features per sprint)
```

## CHECKPOINT

**STOP and wait for developer confirmation.** The developer may:
- Add/remove features
- Change priorities
- Adjust dependencies
- Add acceptance criteria they know about

After confirmation, the developer will use `/ef-implement [feature-name]` for each feature in the recommended order.

## Step 5: Create Jira Tickets (if configured)

If Jira is configured in `techContext.md`, create tickets for the confirmed plan:

1. **Create an Epic** for the module "$ARGUMENTS" (if one doesn't already exist from Step 1)
2. **Create a Story/Task** for each confirmed feature:
   - Title: the feature name
   - Description: the feature description + acceptance direction from Step 2
   - Priority: mapped from P0/P1/P2
   - Linked to the Epic
3. Show the created ticket IDs to the developer:

```
## Jira Tickets Created

Epic: PROJ-100 — [Module Name]
- PROJ-101 — [Feature 1] (P0)
- PROJ-102 — [Feature 2] (P0)
- PROJ-103 — [Feature 3] (P1)
```

The developer can then reference these ticket IDs when running `/ef-implement PROJ-101` or `/ef-implement [feature-name]`.

## Step 6: Update Memory

After developer confirms the plan, run `/ef-context after-plan` to record the planned features in progress.md.
