# Progress

## Current Sprint / Focus
Migrating from MySQL + Express to Supabase (PostgreSQL + Realtime + Edge Functions) for free hosting

## Log
<!-- Newest entries first. Format: - YYYY-MM-DDTHH:MMZ [status] feature-name — notes -->
- 2026-03-06T00:00Z [DONE] supabase-migration — Added Supabase data layer (auth, CRUD, realtime, edge function)
- 2026-03-06T00:00Z [DONE] collection-specific-environments — Environments are now per-collection, each user has active env per collection
- 2026-03-06T00:00Z [DONE] shared-environments — Environments shared across users, per-user active selection
- 2026-03-06T00:00Z [DONE] per-tab-detail-tab — Each API tab remembers its own active detail tab (Params/Auth/Headers/Body)
- 2026-03-06T00:00Z [DONE] reusable-dropdown-menu — Extracted DropdownMenu component for reuse
- 2026-03-06T00:00Z [DONE] sidebar-toolbar — Added scroll-to-active, expand-all, collapse-all icons
- 2026-03-06T00:00Z [INIT] Memory bank initialized

## Planned
- [ ] supabase-migration — Migrate to Supabase for free hosting (PostgreSQL, Realtime, Auth, Edge Functions)
  - [ ] Setup Supabase project & schema
  - [ ] Migrate database (PostgreSQL tables)
  - [ ] Replace API calls with Supabase client
  - [ ] Replace WebSocket with Supabase Realtime
  - [ ] Migrate auth to Supabase Auth
  - [ ] Create Edge Function for proxy endpoint
  - [ ] Deploy frontend
  - [ ] Delete old backend code
