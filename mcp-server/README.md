# Post Umbrella MCP Server

OAuth-protected [Model Context Protocol](https://modelcontextprotocol.io/) server for Post Umbrella. Authenticates users through Supabase and exposes workspace, collection, request, example, and environment tools over streamable HTTP.

## Quick Start

### Prerequisites

- Node.js 22+
- A Supabase project with the main repo's migrations applied
- Auth redirect URLs configured (see [Auth Setup](#supabase-auth-setup))

### Local Development

```bash
npm install
npm run dev
```

### Build and Run

```bash
npm run build
node dist/index.js
```

## Environment Variables

Create `.env.local` for local development:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
PORT=3100
MCP_BASE_URL=http://localhost:3100
WEBAPP_URL=http://localhost:5173
```

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `MCP_BASE_URL` | Public URL of this MCP server | Yes |
| `WEBAPP_URL` | Public URL of the Post Umbrella frontend | Yes |
| `PORT` | Server port (default: 3100) | No |

## Deployment

Deploy to any Node.js host — Render, Fly.io, Railway, a VPS, etc.

**Example with Render:**

1. Create a new **Web Service** pointing to the `mcp-server` directory
2. **Build command:** `npm install && npm run build`
3. **Start command:** `node dist/index.js`
4. Set the environment variables above

> **Important:** This server keeps OAuth/session state in memory. Run a single instance and avoid scale-to-zero for reliable behavior.

## Connecting AI Agents

Once deployed, connect from your AI tools:

**Claude Code:**

```bash
claude mcp add --transport http post-umbrella https://your-mcp-domain.com/mcp
```

**Codex:**

```bash
codex mcp add postUmbrella --url https://your-mcp-domain.com/mcp
```

The agent will detect OAuth support, open the browser, and complete the login flow. If you're already signed into the webapp, you'll see a one-click "Authorize" button.

## Supabase Auth Setup

The MCP server redirects `/authorize` to the webapp for authentication. Add these redirect URLs in your Supabase dashboard under **Authentication → URL Configuration**:

```
# Local development
http://localhost:5173/mcp-complete*

# Production
https://your-webapp-domain.com/mcp-complete*
```

The webapp hosts `mcp-authorize.html` (session check + confirm) and `mcp-complete.html` (magic link callback) as static files in `public/`.

## Available Tools

| Group | Tools |
|-------|-------|
| Workspaces | `list_workspaces`, `get_workspace` |
| Collections | `list_collections`, `get_collection`, `create_collection`, `rename_collection` |
| Folders | `get_folder`, `add_folder`, `rename_folder` |
| Requests | `list_requests`, `get_request`, `create_request`, `update_request`, `delete_request`, `search_apis_by_name` |
| Examples | `list_examples`, `get_example`, `create_example`, `update_example`, `delete_example` |
| Environments | `list_workspace_environments` |

`get_collection` and `get_folder` return recursive trees — nested folders and requests at every level.

## Notes

- Collections are top-level rows with `workspace_id` set and `parent_id = null`
- Folders are nested rows in the same `collections` table with `parent_id` set and `workspace_id = null`
- Search results are filtered by Supabase RLS — only viewable APIs are returned
- Environment listing is read-only with merged current user values over shared initial values
- Dynamic client registration is supported for OAuth public clients (e.g. Codex)
- Destructive tools are limited to requests and examples only
