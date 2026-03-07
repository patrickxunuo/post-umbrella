# Memory File Skeletons

Use these structures when creating memory files. Replace `[...]` placeholders with actual content from code analysis or developer answers.

## projectBrief.md

```markdown
# Project Brief

## Client / Project Name
[who is the client, what is the project called]

## Business Context
[what problem does this project solve, who are the users]

## Core Requirements
- [key requirement 1]
- [key requirement 2]

## Success Criteria
[how do we know the project is done / successful]

## Constraints
[budget, timeline, compliance, or other hard constraints]
```

## techContext.md

```markdown
# Tech Context

## Repository Structure
- Type: [single-repo | multi-repo | monorepo]
- Repositories:
  - [repo-name]: [role, e.g., backend API] — [relative or absolute path if known]
  - [repo-name]: [role, e.g., frontend app] — [path]
  - (list all repos if multi-repo)

## Language & Runtime
- Language: [e.g., TypeScript, Java 21, Python 3.12]
- Runtime: [e.g., Node 20, JVM 21, CPython]

## Frameworks
- Backend: [e.g., NestJS, Spring Boot, FastAPI]
- Frontend: [e.g., Next.js, Nuxt, none]

## Testing
- Unit/API tests: [e.g., Jest, JUnit 5, pytest]
- E2E tests: [e.g., Playwright, Cypress, none]
- Test directory: [e.g., src/__tests__/, tests/]

## Database
- [e.g., PostgreSQL 16, MongoDB 7, none]
- ORM/query: [e.g., Prisma, TypeORM, SQLAlchemy]

## Build & Deploy
- Package manager: [e.g., pnpm, Maven, pip]
- Build command: [e.g., pnpm build, mvn package]
- Deploy target: [e.g., AWS ECS, Vercel, Docker Compose]

## Integrations
- Project management: [e.g., Jira (project key: PROJ), none]
- Documentation: [e.g., Confluence (space: PROJ), none]

## Key Dependencies
- [dependency]: [why it's used]
```

## systemPatterns.md

```markdown
# System Patterns

## Project Structure
[describe the directory layout, e.g., feature-based, layer-based]

## Naming Conventions
- Files: [e.g., kebab-case, PascalCase]
- Functions/methods: [e.g., camelCase]
- Database tables/columns: [e.g., snake_case]

## Code Patterns
- [pattern name]: [brief description and when to use]

## API Conventions
- [e.g., RESTful, RPC-style, GraphQL]
- [response format, error format, auth mechanism]

## Known Pitfalls
(none yet — will be added as the project evolves)
```

## progress.md

> **Merge-friendly format**: Each entry is a self-contained line with UTC timestamp and author. New entries are prepended (newest first). This allows git to auto-merge when multiple developers add entries concurrently.

```markdown
# Progress

## Current Sprint / Focus
[one-line summary of current priorities]

## Log
<!-- Newest entries first. Format: - YYYY-MM-DDTHH:MMZ [status] feature-name (developer) — notes -->
<!-- ALWAYS use UTC time (Z suffix). Run: date -u +"%Y-%m-%dT%H:%MZ" -->
- 2026-02-25T08:00Z [INIT] Project initialized. Memory bank created.

## Planned
- [ ] [feature-name] — [brief description]
```

> **Important**: When updating progress.md, ALWAYS prepend new log entries — never edit or reorder existing lines. ALWAYS use UTC timestamps (not local time) to ensure correct ordering across time zones. This minimizes merge conflicts in team environments.
