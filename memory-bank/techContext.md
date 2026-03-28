# Tech Context

## Repository Structure
- Type: single-repo (monorepo with frontend, desktop, MCP server, website)
- Structure:
  - `src/` — React frontend
  - `src-tauri/` — Desktop app (Tauri v2 / Rust)
  - `mcp-server/` — MCP server (Node.js / TypeScript)
  - `website/` — Landing page (React / Vite)
  - `supabase/` — Database migrations and Edge Functions

## Language & Runtime
- Language: JavaScript (ES Modules) — no TypeScript in main app
- Runtime: Node.js 22+
- MCP Server: TypeScript

## Frameworks
- Frontend: React 18 + Vite
- Backend: Supabase (PostgreSQL + Auth + Realtime + Edge Functions)
- Desktop: Tauri v2 (Rust)
- Real-time: Supabase Realtime (postgres_changes)

## Testing
- Unit/API tests: None configured
- E2E tests: Playwright (TypeScript)
- Test directory: e2e/
- Config: playwright.config.ts

## Database
- Supabase (PostgreSQL) with Row Level Security
- Tables: collections, requests, examples, environments, environment_variables, environment_user_values, collection_variables, collection_variable_user_values, workflows, workspaces, workspace_members, user_profiles, user_active_workspace, user_config
- All IDs are UUIDs
- Timestamps as Unix epoch integers (BIGINT)
- JSON stored as JSONB columns
- Migrations in `supabase/migrations/`

## Build & Deploy
- Package manager: npm
- Build: `npm run build` (Vite) or `npm run tauri:build` (desktop)
- Dev: `npm run dev` (Vite dev server)
- Frontend deploy: Vercel (static)
- Backend: Supabase Cloud
- Desktop: GitHub Actions (Windows + macOS builds)
- MCP: Any Node.js host

## Key Dependencies
- **Frontend:**
  - react, react-dom — UI framework
  - @supabase/supabase-js — Database/auth/realtime client
  - @uiw/react-codemirror — Code editor
  - @codemirror/lang-json, @codemirror/lang-javascript — Language support
  - @codemirror/autocomplete, @codemirror/view, @codemirror/state — Editor extensions
  - @lezer/highlight — Syntax highlighting
  - @uiw/react-json-view — JSON response viewer
  - lucide-react — Icons
  - json5 — JSON with comments support

- **Desktop:**
  - @tauri-apps/api, @tauri-apps/plugin-* — Tauri plugins

## Architecture Notes
- Frontend communicates directly with Supabase (no custom backend)
- Edge Function handles HTTP proxy for CORS bypass
- Supabase Realtime broadcasts table changes to all clients
- Environments are workspace-scoped with per-user current values
- Collection variables scoped to root collections
- Workflows scoped to root collections (collection_id)
- Script execution via sandboxed Function constructor with pm.* API
- Variable substitution: collection vars (lower priority) + env vars (higher priority)
- Auth: Supabase Auth with email/password and Slack OAuth
