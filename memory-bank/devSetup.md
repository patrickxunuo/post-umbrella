# Dev Setup

## Prerequisites

| Tool | Version | Check Command |
|------|---------|---------------|
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Supabase CLI | latest | `supabase --version` |
| Docker | latest | `docker --version` |

## First-Time Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start Supabase (runs PostgreSQL, Auth, Realtime, Edge Functions in Docker)**
   ```bash
   supabase start
   ```

   First run downloads Docker images (~5-10 min). Subsequent starts are fast.

3. **Verify .env file exists** with local Supabase credentials:
   ```
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
   ```

4. **Start Edge Functions** (for proxy, if needed):
   ```bash
   supabase functions serve --env-file supabase/.env.local
   ```

## Quick Start

Script: `dev-start.bat` (Windows) / `dev-start.sh` (Unix)

```bash
# 1. Start Supabase (if not running)
supabase start

# 2. Start Vite client
npm run client
```

## Services

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://127.0.0.1:5173 | Vite dev server (React app) |
| Supabase API | http://127.0.0.1:54321 | REST API + Realtime |
| Supabase Studio | http://127.0.0.1:54323 | Database admin UI |
| Inbucket | http://127.0.0.1:54324 | Email testing (magic links) |
| Edge Functions | http://127.0.0.1:54321/functions/v1 | Serverless functions |

**Important:** Access the app via `http://127.0.0.1:5173` (not `localhost`) to match Supabase URL and avoid CORS issues.

## Stop

```bash
# Stop Vite (Ctrl+C in terminal)

# Stop Supabase
supabase stop

# Stop Supabase and remove data
supabase stop --no-backup
```

## Database

- Schema defined in `supabase/schema.sql` and `supabase/migrations/`
- Apply migrations: `supabase db reset` (resets DB and runs all migrations)
- Supabase Studio for browsing: http://127.0.0.1:54323

## Edge Functions

The proxy function is at `supabase/functions/proxy/index.ts`. To serve locally:

```bash
supabase functions serve --env-file supabase/.env.local
```

The `.env.local` file contains `SKIP_AUTH=true` for local development.

## Troubleshooting

### Port 5173 in use
Vite will auto-select next available port (5174, 5175, etc.)

### Supabase won't start
- Ensure Docker is running
- Try `supabase stop` then `supabase start`
- Check `docker ps` for stuck containers

### CORS errors
- Use `127.0.0.1` instead of `localhost` in browser
- Ensure `.env` has matching URL

## Last Verified
2026-03-06

## E2E Environment — existing-account invites (GH-77)

Prerequisites: dependencies installed, Chromium installed for Playwright, Docker running the existing local Supabase stack with container `supabase_auth_post-umbrella`, Deno on PATH, and free ports 8000 and 5173. The focused runner uses `localhost:54321` (IPv6 works when Docker's IPv4 forwarding is unavailable), the actual checked-out invitation Edge Function in Deno, and this checkout's Vite UI. It reads the local Auth JWT secret from Docker without printing it; no production credentials or backend mocks are used.

```bash
node e2e/helpers/inviteFlightRunner.mjs --ui e2e/invite-existing-user.spec.ts --project=chromium --no-deps --reporter=list
```

The runner invokes configured `npm run test:e2e` with the supplied filters, owns/awaits its Deno/Vite processes and tears them down. Specs create and clean isolated local users/workspaces and authenticate their own callers (`--no-deps` avoids the unrelated shared login setup). It does not reset the database or provide other Edge Functions such as the HTTP proxy; this is the focused invite environment, not a replacement for the whole application's test environment. Set `PAPERPLANE_CAPTURE_SCREENSHOTS=1` to collect opened/pending/completed/error/reload states under `test-results/screenshots/`. Verified: 4/4 passed on 2026-10-06.
