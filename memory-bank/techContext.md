# Tech Context

## Repository Structure
- Type: single-repo
- Structure: Combined frontend and backend in one repository
  - `src/` — React frontend
  - `server/` — Express.js backend

## Language & Runtime
- Language: JavaScript (ES Modules)
- Runtime: Node.js

## Frameworks
- Frontend: React 18 + Vite
- Backend: Express.js 4.x
- Real-time: WebSocket (ws library)

## Testing
- Unit/API tests: None configured
- E2E tests: None configured
- Test directory: N/A

## Database
- MySQL (via mysql2/promise)
- No ORM — raw SQL queries with parameterized statements
- Tables: collections, requests, examples, environments, users, sessions, user_active_environment

## Build & Deploy
- Package manager: npm
- Build command: `npm run build` (Vite)
- Dev command: `npm run dev` (concurrently runs frontend + backend)
- Deploy target: Currently local development only
- **Planned migration**: Supabase (PostgreSQL + Realtime + Auth + Edge Functions)

## Key Dependencies
- **Frontend:**
  - react, react-dom — UI framework
  - @codemirror/lang-json, @uiw/react-codemirror — Code editor for JSON/scripts
  - lucide-react — Icons
  - axios — HTTP client (for proxy requests)

- **Backend:**
  - express — HTTP server
  - ws — WebSocket server for real-time sync
  - mysql2 — MySQL database driver
  - uuid — ID generation
  - cors — CORS middleware

## Integrations
- Project management: None
- Documentation: None

## Architecture Notes
- Frontend communicates with backend via REST API + WebSocket
- Backend broadcasts changes to all connected clients for real-time sync
- Environments are collection-specific (each collection has its own environments)
- User authentication via email (no password) with session tokens
