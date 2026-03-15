# Post Umbrella MCP Server

OAuth-protected MCP server for Post Umbrella. It authenticates users through Supabase, issues MCP bearer tokens, and exposes workspace, collection, folder, request, example, environment lookup, and search tools over streamable HTTP.

## What It Provides

- OAuth metadata and authorization endpoints for MCP clients
- Supabase-backed user authentication with magic links
- MCP tools for:
  - workspaces
  - collections and folders
  - requests
  - examples
  - workspace environment lookup
  - API search by name

## Requirements

- Node.js 22+
- A Supabase project with this repo's schema/migrations applied
- Supabase Auth redirect URL for this server's callback

## Environment Variables

Create `mcp-server/.env.local` for local development:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
PORT=3100
MCP_BASE_URL=http://localhost:3100
```

Production variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
MCP_BASE_URL=https://your-public-mcp-domain.com
PORT=3100
```

## Local Development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run the built server:

```bash
node dist/index.js
```

## Tool Overview

Current MCP tools are grouped like this:

- Workspaces
  - `list_workspaces`
  - `get_workspace`
- Collections
  - `list_collections`
  - `get_collection`
  - `create_collection`
  - `rename_collection`
- Folders
  - `get_folder`
  - `add_folder`
  - `rename_folder`
- Requests / APIs
  - `list_requests`
  - `get_request`
  - `create_request`
  - `update_request`
  - `delete_request`
  - `send_request`
  - `search_apis_by_name`
- Examples
  - `list_examples`
  - `get_example`
  - `create_example`
  - `update_example`
  - `delete_example`
- Environments
  - `list_workspace_environments`

`send_request` optionally accepts either `environment_id` or `environment_name`. When provided, the server resolves `{{variable}}` placeholders using that environment before sending the request.

`get_collection` returns the full recursive tree for a top-level collection, including nested folders and requests at every level. `get_folder` does the same starting from a nested folder.

## Supabase Auth Setup

Add this redirect URL in Supabase Auth settings:

```text
http://localhost:3100/auth/callback
```

For production, add your deployed callback too:

```text
https://your-public-mcp-domain.com/auth/callback
```

If you use magic links with query params, allow the callback pattern that includes the session query string.

## Deploying

This server keeps some OAuth/session state in memory. For reliable behavior:

- run a single instance
- avoid scale-to-zero for production usage
- keep `MCP_BASE_URL` set to the exact public base URL

Suggested process:

1. Install dependencies including dev dependencies during build.
2. Run `npm run build`.
3. Start with `node dist/index.js`.
4. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `MCP_BASE_URL` in your host.

## Connecting From Codex

After deployment:

```bash
codex mcp add postUmbrella --url https://your-public-mcp-domain.com/mcp
```

Codex will detect OAuth support, open the browser, and complete the login flow through this server.

## Notes

- Collections are top-level rows with `workspace_id` set and `parent_id = null`.
- Folders are nested rows in the same `collections` table with `parent_id` set and `workspace_id = null`.
- Collection and folder reads are recursive, so they can be used to inspect deep request trees from a single entry point.
- Search results are filtered by Supabase row-level security, so only viewable APIs are returned.
- Environment listing is read-only and includes merged current user values over shared initial values.
- Dynamic client registration is supported for OAuth public clients like Codex.
- Destructive tools are intentionally limited to requests and examples only.
