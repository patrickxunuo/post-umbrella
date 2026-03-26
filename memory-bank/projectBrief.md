# Project Brief

## Project Name
Post Umbrella

## Business Context
A self-hosted, real-time collaborative API testing workspace for teams. An open-source alternative to Postman with full data ownership.

## Core Requirements
- Create and organize API requests in nested collections/folders
- Send HTTP requests and view responses (JSON syntax highlighting, tree view)
- Save request/response pairs as "Examples"
- Environment variables with `{{variable}}` substitution
- Collection variables (shared per collection, per-user current values)
- Collection-level auth inheritance (Bearer Token from parent folder/collection)
- Pre-request and post-response scripts with `pm.*` API
- Workflow builder — reusable sequential API flows with drag-and-drop
- Import/export Postman collections (v2.1 format), cURL import
- Real-time sync across multiple users via Supabase Realtime
- Workspaces with role-based access (admin, developer, reader)
- MCP server for AI agent integration
- Desktop app (Windows, macOS) via Tauri v2

## Target Users
- Development teams who want a self-hosted Postman alternative
- Teams who need real-time collaboration on API testing
- Users who prefer full data ownership over cloud-based API tools

## Success Criteria
- Users can create, send, and save API requests with variable substitution
- Changes sync in real-time across all connected users
- Workflows enable repeatable multi-step API testing
- Collections can be imported from/exported to Postman format
- App runs reliably on Supabase (free tier) with minimal maintenance

## Constraints
- Must be hostable for free or minimal cost (Supabase free tier)
- No TypeScript in main app (JavaScript only)
- Supabase as sole backend (no custom server)
- Desktop builds via GitHub Actions CI/CD
