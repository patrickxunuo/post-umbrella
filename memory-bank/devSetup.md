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
