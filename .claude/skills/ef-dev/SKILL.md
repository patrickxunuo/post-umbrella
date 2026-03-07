---
name: ef-dev
description: Explore, record, and run the local development environment setup
disable-model-invocation: true
argument-hint: [start|setup|explore|stop]
---

# Dev Environment: $ARGUMENTS

Manage the local development environment. Explore how to run the project, record the steps, and reuse them next time.

## Route by Action

- `start` or no argument → go to **Run Dev Environment**
- `setup` → go to **First-Time Setup**
- `explore` → go to **Explore & Record** (force re-exploration even if devSetup.md exists)
- `stop` → go to **Stop Environment**

---

## Run Dev Environment

### Step 1: Check for Recorded Setup

1. Check if a startup script exists at project root (`dev-start.bat`, `dev-start.sh`, `dev-start.ps1`, etc.) — also check `devSetup.md` for the recorded script filename
2. If YES → go to **Step 2: Run Startup Script**
3. If NO → check if `memory-bank/devSetup.md` exists
   - If YES → generate the startup script from it first, then go to Step 2
   - If NO → go to **Explore & Record**

### Step 2: Run Startup Script

1. Run the startup script
2. If a step fails:
   - Show the error to the developer
   - Try to diagnose and fix (missing dependency, port conflict, stale config, etc.)
   - If the fix reveals the recorded steps are outdated → update `memory-bank/devSetup.md` and regenerate the script
   - If you cannot fix it → suggest running `/ef-dev explore` to re-explore from scratch
4. Once all services are running, show status summary:

```
## Dev Environment Running

| Service       | URL                    | Status |
|---------------|------------------------|--------|
| Backend API   | http://localhost:XXXX  | ✓ UP   |
| Frontend      | http://localhost:XXXX  | ✓ UP   |
| Database      | localhost:XXXX         | ✓ UP   |
| ...           | ...                    | ...    |
```

---

## First-Time Setup

Full setup for a fresh clone. Run this once on a new machine.

### Step 1: Read Context

1. Read `memory-bank/devSetup.md` if it exists — follow the **First-Time Setup** section
2. If `devSetup.md` does not exist → go to **Explore & Record** first, then come back

### Step 2: Execute First-Time Steps

Follow the **First-Time Setup** section in `devSetup.md`:
1. Install system prerequisites (check each one, skip if already installed)
2. Install project dependencies
3. Set up environment files (copy `.env.example` → `.env`, etc.)
4. Set up database (run migrations, seed data)
5. Run a build/compile check
6. Run tests to verify setup

If any step fails, diagnose, fix, and update `devSetup.md`.

### Step 3: Start Dev Servers

After setup completes, run the startup script to start all services. If no startup script exists yet, generate one from `devSetup.md` first (see Explore & Record → Step 6).

Verify all services come up and health checks pass before reporting success.

---

## Explore & Record

Discover how to run the project locally by examining project files, then record the steps.

### Step 1: Read Existing Context

1. Read `memory-bank/index.md` if it exists
2. Read `memory-bank/techContext.md` if it exists — understand the tech stack
3. Note the repository structure (single-repo, multi-repo, monorepo)

### Step 2: Scan Project Files

Look for setup clues in this order. Read every file that exists — each layer adds information:

**Top-level docs:**
- `README.md`, `CONTRIBUTING.md`, `docs/setup.md`, `docs/development.md`
- Extract: setup instructions, prerequisites, environment variables

**Package/dependency files:**
- `package.json` (check `scripts` section — look for `dev`, `start`, `serve`, `build`)
- `pnpm-workspace.yaml`, `lerna.json`, `turbo.json` (monorepo indicators)
- `pom.xml`, `build.gradle`, `build.gradle.kts`
- `requirements.txt`, `pyproject.toml`, `Pipfile`, `poetry.lock`
- `go.mod`, `Cargo.toml`, `*.csproj`, `*.sln`
- `Gemfile`

**Container/infra files:**
- `docker-compose.yml`, `docker-compose.*.yml` — services, ports, volumes, env vars
- `Dockerfile`, `Dockerfile.*` — build steps, exposed ports
- `.devcontainer/` — VS Code dev container config
- `Makefile`, `Taskfile.yml`, `justfile` — task runner commands
- `Procfile` — process definitions

**Environment config:**
- `.env.example`, `.env.sample`, `.env.template`, `.env.development`
- Extract: required environment variables, default values

**Database setup:**
- Migration directories (`migrations/`, `db/migrate/`, `prisma/`, `alembic/`, `flyway/`)
- Seed files (`seed.ts`, `seeds/`, `fixtures/`)
- Database init scripts (`init.sql`, `docker-entrypoint-initdb.d/`)

**Multi-repo check:**
If `techContext.md` lists multiple repos, or if you see docker-compose referencing services at other paths:
- Note which services live in which repo
- Record the startup order and dependencies between repos

### Step 3: Build the Setup Model

From your findings, determine:

1. **Prerequisites**: System tools needed (Node, Python, Java, Docker, etc.) and versions
2. **Dependencies**: How to install project dependencies (`npm install`, `pip install`, etc.)
3. **Environment**: What `.env` files are needed, what values they need
4. **Database**: How to create/migrate/seed the database
5. **Services**: What needs to run (backend, frontend, worker, database, cache, etc.)
6. **Start commands**: The exact command to start each service
7. **Ports**: What port each service uses
8. **Startup order**: Which services must start first (e.g., database before backend)
9. **Health checks**: How to verify each service is running (URL to hit, expected response)

### Step 4: Test the Setup

Try to actually run the project using what you discovered:

1. Check prerequisites are installed (run version commands)
2. Install dependencies if not already installed
3. Set up environment files if missing (ask developer for secrets/credentials you can't guess)
4. Start services in the correct order
5. Verify each service is running using health checks

**For each step:**
- If it works → record the exact command
- If it fails → diagnose, fix, record the corrected command
- If it needs manual input (credentials, API keys) → note what the developer needs to provide

### Step 5: Write devSetup.md

Create `memory-bank/devSetup.md` with everything you discovered. Use the template in [references/devsetup-template.md](references/devsetup-template.md) as the structure — replace all `[...]` placeholders with actual values.

### Step 6: Generate Startup Script

Create a startup script at the project root (or wrapper root for multi-repo) that starts the entire dev environment with one command.

**Choose the script format based on the current OS and shell:**
- Windows (cmd) → `dev-start.bat`
- Windows (PowerShell) → `dev-start.ps1`
- Windows (Git Bash / WSL) → `dev-start.sh`
- Mac / Linux → `dev-start.sh`

Use the format most natural for the developer's environment. If unsure, ask.

**Rules:**
- Extract the exact commands from the Quick Start section of `devSetup.md`
- Start services in the correct order with waits/health-checks between them
- Print clear status output as each service comes up
- Handle Ctrl+C / termination gracefully — clean up child processes
- **Add the script to `.gitignore`** — this file is local to each developer's machine, do NOT commit it
- Also generate a matching `dev-stop.*` script if useful (e.g., docker-compose down, kill processes by port)
- **Record the script filename in `devSetup.md`** under Quick Start (e.g., "Script: `dev-start.bat`") so other skills know what to look for

**The script must include:**
1. Startup commands in dependency order (database → backend → frontend, etc.)
2. Health-check waits — poll each service's URL/port before moving to the next
3. Final summary showing all service URLs and their status
4. Graceful shutdown on Ctrl+C

### Step 7: Verify the Script

**Run the script immediately after generating it.** Verify:
1. All services start without errors
2. Health checks pass for each service
3. The final status output is correct

If anything fails, fix the script and re-run until it works. The script is not done until it has been verified.

### Step 8: Update Index

1. Update `memory-bank/index.md` — add `devSetup.md` to the file list
2. If `techContext.md` is missing startup/port info that you discovered, update it too

### Step 9: Show Status

After verification, show the status summary to the developer.

---

## Stop Environment

1. Look for `dev-stop.*` at project root — if found, run it
2. Otherwise, read `memory-bank/devSetup.md` and follow the **Stop** section
3. If no stop section exists, find and stop running dev processes:
   - Check for docker-compose → `docker-compose down`
   - Check for running node/python/java processes on known ports
   - Show what was stopped

---

## General Rules

- **Always record what works.** The whole point is that next time startup takes seconds, not minutes.
- **Update devSetup.md when things change.** If a port changed, a dependency was added, or a step broke and you fixed it — update the file and regenerate the startup script.
- **Scripts must be verified.** Never deliver a startup script without running it first. If it fails, fix and re-run.
- **Ask when you must.** Don't guess database passwords or API keys. Ask the developer.
- **Handle multi-repo.** If the project spans multiple repos, record the setup for each repo and the startup order between them.
- **Timestamps matter.** Always update the "Last Verified" date when you verify the setup works.
