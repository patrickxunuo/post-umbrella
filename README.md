# Post Umbrella

A self-hosted, real-time collaborative API testing workspace for teams. An open-source alternative to Postman.

## Features

- **Request Builder** — GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS with headers, body (JSON/raw/form-data), query params, and auth
- **Response Viewer** — Status, headers, body with syntax highlighting
- **Saved Examples** — Save request/response pairs for documentation and testing
- **Environment Variables** — `{{variable}}` substitution across URLs, headers, body, and auth
- **Real-time Collaboration** — WebSocket-powered sync with live presence
- **Workspaces** — Organize collections and control access per team
- **Import/Export** — Postman v2.1 collection format, cURL import
- **MCP Server** — AI agent integration via OAuth-protected [Model Context Protocol](mcp-server/)
- **Desktop App** — Native Windows and macOS builds via [Tauri](src-tauri/)
- **Dark/Light Theme** — Toggle between themes

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Lucide React, CodeMirror |
| Backend | Supabase (PostgreSQL, Auth, Edge Functions, Realtime) |
| Desktop | Tauri v2 (Rust) |
| MCP | Node.js, OAuth 2.0 |

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Docker](https://docker.com) (for local Supabase)

### 1. Clone and install

```bash
git clone https://github.com/patrickxunuo/post-umbrella.git
cd post-umbrella
npm install
```

### 2. Start local Supabase

```bash
supabase start
```

This outputs your local credentials (API URL, anon key, service_role key).

### 3. Configure environment

Create `.env.local` in the project root:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=your-anon-key-from-supabase-start
VITE_EMAIL_DOMAIN=              # Optional: restrict signups to a domain
```

### 4. Push migrations and start

```bash
supabase db push
npm run dev
```

In another terminal, start Edge Functions:

```bash
supabase functions serve
```

The app will be available at `http://localhost:5173`.

## Deployment

### Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Link and push:
   ```bash
   supabase link --project-ref your-project-ref
   supabase db push
   supabase functions deploy
   ```
3. Add auth redirect URLs in **Authentication → URL Configuration**:
   ```
   https://your-domain.com/*
   https://your-domain.com/mcp-complete*
   ```

### Frontend

The frontend is a standard Vite build. Deploy to any static host — Vercel, Netlify, Cloudflare Pages, etc.

```bash
npm run build
# Deploy the dist/ folder
```

Set these environment variables on your hosting platform:

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_SUPABASE_URL` | Supabase project URL | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `VITE_EMAIL_DOMAIN` | Restrict signups to email domain (e.g. `@company.com`) | No |
| `VITE_SUPABASE_PROXY_URL` | Custom proxy function URL | No |

### MCP Server

See [mcp-server/README.md](mcp-server/README.md) for full setup. Quick version:

```bash
cd mcp-server
npm install && npm run build
node dist/index.js
```

Deploy to any Node.js host (Render, Fly.io, Railway, VPS). See the [MCP README](mcp-server/README.md) for environment variables and AI agent connection instructions.

### Desktop App (Tauri)

Requires [Rust](https://www.rust-lang.org/tools/install) and [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm run tauri build
```

- **Windows** — produces `.msi` and `.exe` in `src-tauri/target/release/bundle/`
- **macOS** — produces `.dmg` and `.app` in `src-tauri/target/release/bundle/`

> Cross-compilation is not supported. Build on the target platform, or use GitHub Actions with platform-specific runners.

## Project Structure

```
post-umbrella/
├── src/                        # Frontend (React)
│   ├── main.jsx
│   ├── App.jsx
│   ├── App.css
│   ├── components/
│   └── data/supabase/          # Supabase client and data layer
├── supabase/
│   ├── functions/proxy/        # Edge Function (CORS bypass)
│   └── migrations/             # Database migrations
├── src-tauri/                  # Desktop app (Tauri/Rust)
├── mcp-server/                 # MCP server (Node.js)
└── website/                    # Landing page
```

## User Roles

- **Admin** — Full access, manage users and workspaces
- **Developer** — Create, edit, and delete requests/collections
- **Reader** — View-only access

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push and open a Pull Request

## License

MIT — see [LICENSE](LICENSE) for details.

## Acknowledgments

- Inspired by [Postman](https://postman.com)
- Built with [Supabase](https://supabase.com)
- Icons by [Lucide](https://lucide.dev)
