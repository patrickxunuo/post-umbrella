---
name: ef-context
description: Update, expand, and organize the project memory bank
disable-model-invocation: true
argument-hint: [trigger-reason]
---

# Update Memory: $ARGUMENTS

Review the current state of the project and update the memory bank accordingly. The memory bank is a living knowledge system that grows with the project.

## Memory Bank Structure

The memory bank starts with core files and expands as the project grows:

```
memory-bank/
├── index.md                  # ALWAYS read first — links to all other files
├── projectBrief.md           # Business context (stable, rarely changes)
├── techContext.md             # Tech stack, dependencies, architecture
├── systemPatterns.md          # Code conventions and patterns
├── progress.md                # Current status and recent progress
└── [topic].md                 # AI creates new files as needed
```

## Rules

1. **Always read `memory-bank/index.md` first** — it is the map of all memory
2. **Keep `index.md` under 100 lines** — it's a directory, not a document
3. **Split files when they exceed ~200 lines** — create topic-specific files and link from index
4. **Never delete information** — archive outdated content, don't remove it
5. **One topic per file** — if a file covers multiple unrelated topics, split it
6. **Update index.md whenever you create or rename a memory file**

## Step 1: Assess Current Memory

1. Read `memory-bank/index.md` (or all core files if index doesn't exist yet)
2. List what exists and what may need updating
3. Check `git log --oneline -20` for recent changes
4. Check `git diff --stat` for uncommitted work

## Step 2: Determine What Changed

Based on the trigger reason (`$ARGUMENTS`), identify what needs updating:

| Trigger | Files to Update |
|---------|----------------|
| `after-implement` | progress.md (prepend log entry), possibly systemPatterns.md if new patterns emerged |
| `after-review` | systemPatterns.md if review revealed convention gaps |
| `after-plan` | progress.md (add planned items to Planned section) |
| `tech-change` | techContext.md — new dependency, architecture change |
| `new-pattern` | systemPatterns.md — or create a dedicated patterns file |
| `lesson-learned` | Create/update a lessons file |
| `full-sync` | Review and update ALL memory files |
| (no argument) | Auto-detect what's stale by comparing memory to actual project state |

**progress.md merge rules** — To avoid git conflicts in team environments:
- **Log section**: ALWAYS prepend new entries at the top with UTC timestamps (`YYYY-MM-DDTHH:MMZ`). Never edit or reorder existing entries.
- **Planned section**: Add new items; mark completed items by moving them to a log entry instead of deleting.
- **Current Sprint / Focus**: This is the only section that may be edited in place (keep it to one line).

## Step 3: Update Memory Files

For each file that needs updating:

1. Read the current content
2. Determine if the update should:
   - **Edit in place** — small change to existing content
   - **Append** — new information that extends existing content
   - **Split** — file is too large, create a new topic file
   - **Archive** — move outdated content to `[topic]-archive.md`
3. Make the update
4. Update `index.md` if any files were created, renamed, or reorganized

### When to Create a New File

Create a new memory file when:
- An existing file exceeds ~200 lines
- A distinct new topic emerges (e.g., deployment patterns, API conventions, specific module knowledge)
- The developer explicitly asks to remember something specific

Naming convention: `memory-bank/[topic].md` — lowercase, hyphenated, descriptive.

Examples:
- `memory-bank/auth-patterns.md` — authentication/authorization patterns
- `memory-bank/api-conventions.md` — API design conventions
- `memory-bank/deployment.md` — deployment and infra knowledge
- `memory-bank/module-orders.md` — knowledge specific to the orders module
- `memory-bank/lessons.md` — lessons learned from bugs and reviews

### When to Archive

Move content to `[topic]-archive.md` when:
- Sprint progress entries are older than 2 sprints
- Patterns were superseded by new patterns
- Decisions were reversed

## Step 4: Initialize Memory (if needed)

If `memory-bank/index.md` does not exist, initialize the memory bank.

### 4.1: Create index.md

```markdown
# Memory Bank Index

Project memory. Read this file first to find what you need.

## Core Files
- [projectBrief.md](projectBrief.md) — Business context and client info
- [techContext.md](techContext.md) — Tech stack, dependencies, architecture
- [systemPatterns.md](systemPatterns.md) — Code conventions and patterns
- [progress.md](progress.md) — Current status and development progress

## Topic Files
(none yet — will be created as the project grows)

## Last Updated
[date]
```

### 4.2: Detect Project Scenario

Check if the project already has code:
- Look for: `package.json`, `pom.xml`, `build.gradle`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, or similar
- Check if `src/`, `app/`, `lib/`, or similar directories contain source files

**Existing code found** → go to 4.3 (Code Analysis + Supplement)
**No code found** → go to 4.4 (Interview)

### 4.3: Code Analysis + Supplement (existing project)

Scan the project and auto-populate what you can:

**techContext.md** — Analyze:
- Package manager files → language, runtime, dependencies
- Config files (tsconfig, .eslintrc, docker-compose, etc.) → build tools, deploy setup
- Test directories and test files → test framework and conventions
- Database migrations or ORM config → database and ORM
- Check for signs of multi-repo setup (e.g., docker-compose referencing other services, separate frontend/backend directories, git submodules) → repository structure

**systemPatterns.md** — Analyze:
- Directory structure → project layout pattern (feature-based, layer-based, etc.)
- Several representative source files → naming conventions, code patterns
- API route files → API conventions, response format
- Existing README or docs → documented conventions

**progress.md** — Analyze:
- `git log --oneline -30` → what's been built so far
- Current state of the codebase → what appears done vs. in progress

After analysis, present your findings to the developer:

> "Here's what I found from your codebase:"
> [show key findings per file]
> "Please confirm, correct, or add anything I missed."

Then ask about information that **cannot be inferred from code**:
- "What is the business context of this project? Who are the users?"
- "Is this a single-repo, multi-repo, or monorepo project? If multi-repo, what are the other repos and their paths?"
- "What are the deployment targets / environments?"
- "Do you use Jira / Confluence? If so, what's the project key / space?"
- "Any known pitfalls or lessons learned so far?"
- "What are the current priorities or next planned features?"

If Jira/Confluence is configured, use MCP tools to pull additional context:
- Search Confluence for project documentation, tech specs, architecture docs
- Search Jira for recent epics/tickets to understand current scope and priorities

Fill in `projectBrief.md` and supplement other files based on answers.

### 4.4: Interview (new project)

No code to analyze. Ask the developer structured questions:

**For projectBrief.md:**
- "What is this project? What problem does it solve?"
- "Who are the target users?"
- "What are the core requirements?"
- "Any hard constraints (timeline, budget, compliance)?"

**For techContext.md:**
- "What language and framework will you use?"
- "Is this a single-repo project, or are there separate repos (e.g., frontend and backend)? If multi-repo, list them and their paths."
- "What test framework? Any E2E testing planned?"
- "What database, if any?"
- "How will you deploy (cloud, Docker, etc.)?"

**For systemPatterns.md:**
- "Any preferred code conventions or project structure?"
- "API style preference (REST, GraphQL, RPC)?"

**For integrations:**
- "Do you use Jira for project management? What's the project key?"
- "Do you use Confluence for documentation? What's the space key?"

If Jira/Confluence is configured, use MCP tools to pull project documentation and existing tickets to enrich the memory files.

Fill in memory files based on answers. Use the skeletons below as structure reference.

### 4.5: Recommend Test Frameworks (if missing)

After populating techContext.md (from either 4.3 or 4.4), check if test frameworks are defined. If unit/API tests or E2E tests are missing, recommend options based on the project's language and framework:

**Unit / API Tests** — use the language-native framework:

| Language / Framework | Recommended |
|---------------------|-------------|
| TypeScript / Node   | Vitest, Jest |
| Java / Spring Boot  | JUnit 5 + MockMvc |
| Python / FastAPI    | pytest + httpx |
| Python / Django     | pytest-django |
| Go                  | testing + httptest |
| C# / .NET           | xUnit + WebApplicationFactory |

**E2E Tests** — always recommend **Playwright (TypeScript)**. Playwright tests are written in TypeScript regardless of the backend language. This keeps E2E tests in a single consistent language across all projects.

Present the recommendation to the developer:
> "I noticed your project doesn't have [unit tests / E2E tests] set up. For your stack ([stack]), I'd recommend [framework]. Want me to add it to techContext.md?"

If the developer agrees:
1. Update `techContext.md` with the chosen test framework
2. Create test directory structure if it doesn't exist
3. Add basic test configuration files (e.g., `playwright.config.ts`, `vitest.config.ts`)
4. Install dependencies if the developer approves

### 4.6: Set Up Merge-Friendly Config (team projects)

If the project has multiple contributors, recommend adding a `.gitattributes` entry to reduce merge conflicts on frequently-updated memory files:

```
memory-bank/progress.md merge=union
```

The `union` merge strategy keeps all lines from both sides during a merge, which works well with the append-only log format of progress.md.

> "This project has multiple contributors. Want me to add a `.gitattributes` rule so `progress.md` uses union merge? This avoids most merge conflicts when multiple people update progress concurrently."

### File Skeletons

Read [references/skeletons.md](references/skeletons.md) for the template structures of each memory file (projectBrief, techContext, systemPatterns, progress). Replace all `[...]` placeholders with actual content from code analysis or developer answers.

## Step 5: Report Changes

After updating, show:

```
## Memory Update Summary

### Files Updated
- [file] — [what changed]

### Files Created
- [file] — [why]

### Files Archived
- [old] → [archive file]

### Current Memory Map
[copy of index.md contents]
```
