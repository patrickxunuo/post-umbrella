# 🌂 Post Umbrella

> A self-hosted, real-time collaborative API testing workspace for teams.
> Open-source alternative to **Postman** — running on **your** infrastructure, with AI agents built in.

![Post Umbrella — request editor](https://github.com/user-attachments/assets/859aa77d-9d80-4a2c-b1a2-bffb5e701a0a)

## ✨ Features

- 🛠️ **Full Request Builder** — every HTTP method, headers, JSON / raw / form-data bodies, query params, Bearer auth
- 📦 **Saved Examples** — snapshot request/response pairs for docs and regression testing
- 🌱 **Variables Everywhere** — environment + collection variables with `{{key}}` substitution across URLs, headers, body, and auth
- 🛤️ **Path Variables** — Postman-style `:id` per-request, with inline editing and a hover popover
- 🔁 **Workflow Builder** — drag requests into reusable sequential flows with live reports + console
- 👥 **Real-time Collaboration** — WebSocket-powered live sync with presence avatars
- 🏢 **Workspaces & Roles** — organize collections, scope access per team (Admin / Developer / Reader)
- 📥 **Import / Export** — Postman v2.1, OpenAPI / Swagger 3.x, Insomnia v4, cURL — round-trip safe
- 🤖 **MCP Server** — AI agents (Claude Code, Codex, …) hit your workspace via OAuth-protected [Model Context Protocol](mcp-server/)
- 💻 **Desktop App** — native Windows + macOS via [Tauri v2](src-tauri/) — no browser needed
- 🌗 **Dark / Light Theme** — theme-aware syntax highlighting and one-click toggle

## 🚀 Get Started

Full setup walkthrough — local dev, Supabase deployment, frontend hosting, MCP server, and desktop builds:

👉 **[post-umbrella.netlify.app/get-started](https://post-umbrella.netlify.app/get-started)**

## 🧱 Tech Stack

| Layer    | Technology                                            |
|----------|-------------------------------------------------------|
| Frontend | React 18 · Vite · Lucide · CodeMirror                 |
| Backend  | Supabase (PostgreSQL · Auth · Edge Functions · Realtime) |
| Desktop  | Tauri v2 (Rust)                                       |
| MCP      | Node.js · OAuth 2.0                                   |

## 📂 Project Structure

```
post-umbrella/
├── src/             # Frontend (React + Vite)
├── supabase/        # Migrations + Edge Functions
├── src-tauri/       # Desktop app (Tauri / Rust)
├── mcp-server/      # MCP server (Node.js)
└── website/         # Landing page
```

## 🤝 Contributing

PRs welcome! Fork, branch (`feat/...`), commit, open a PR. See [CHANGELOG.md](CHANGELOG.md) for what's shipped.

## 📜 License

MIT — see [LICENSE](LICENSE).

## 🙏 Acknowledgments

Inspired by [Postman](https://postman.com). Built on [Supabase](https://supabase.com). Icons by [Lucide](https://lucide.dev).
