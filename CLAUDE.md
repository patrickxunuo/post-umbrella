# CLAUDE.md - Post Umbrella

A self-hosted, network-accessible API testing tool (Postman alternative) with real-time sync across users.

## Quick Start

```bash
# Start development (client + server)
npm run dev

# Server: http://localhost:3001
# Client: http://localhost:5173
# WebSocket: ws://localhost:3001

# MySQL must be running (127.0.0.1:3306, root/root, db: post_umbrella)
```

## Tech Stack

**Frontend:** React 18, Vite, lucide-react icons, @uiw/react-codemirror, axios
**Backend:** Node.js/Express, WebSocket (ws), MySQL2
**Database:** MySQL 5.7+

## Project Structure

```
post-umbrella/
├── server/
│   ├── index.js              # Express + WebSocket server
│   ├── db.js                 # MySQL setup and helpers
│   └── routes/
│       ├── auth.js           # Login/logout/verify
│       ├── collections.js    # Collection CRUD
│       ├── requests.js       # Request CRUD
│       ├── examples.js       # Saved response CRUD
│       ├── environments.js   # Environment variables
│       ├── proxy.js          # HTTP proxy (CORS bypass)
│       └── sync.js           # Import/Export
├── src/
│   ├── main.jsx              # Entry with providers
│   ├── App.jsx               # Main component (~1300 lines)
│   ├── App.css               # Design system (~4200 lines)
│   ├── api/client.js         # API client
│   ├── components/           # React components
│   │   ├── RequestEditor.jsx     # Request builder
│   │   ├── ResponseViewer.jsx    # Response display
│   │   ├── Sidebar.jsx           # Navigation tree
│   │   ├── JsonEditor.jsx        # CodeMirror editor
│   │   ├── EnvironmentEditor.jsx # Env management
│   │   ├── EnvironmentSelector.jsx
│   │   ├── MethodSelector.jsx    # HTTP method dropdown
│   │   ├── TypeSelector.jsx      # Body type dropdown
│   │   ├── EnvVariableInput.jsx  # {{var}} autocomplete
│   │   ├── Toast.jsx             # Notifications
│   │   ├── ConfirmModal.jsx      # Confirm dialogs
│   │   └── PromptModal.jsx       # Input dialogs
│   └── hooks/useWebSocket.js # Real-time sync
└── package.json
```

## Key Patterns

### State Management
- React hooks (useState, useEffect, useCallback)
- Context API for global utilities (Toast, ConfirmModal, PromptModal)
- localStorage for persistence (auth, tabs, theme, sidebar width)

### Tab System
- Multi-tab interface with dirty state tracking
- Tabs stored as objects: `{ id, type, request/example, dirty, response }`
- Conflict detection for concurrent edits via WebSocket

### Environment Variables
- Pattern: `{{variable_key}}`
- Substituted in URL, headers, body, auth token before sending
- One active environment per user

### WebSocket Events
```javascript
// Broadcast events from backend:
'collection:create/update/delete'
'request:create/update/delete'
'example:create/update/delete'
'environment:create/update/delete/activate/deactivate'
'sync:import'
```

### Database Schema
- **collections**: id, name, parent_id, timestamps
- **requests**: id, collection_id, name, method, url, headers (JSON), body, body_type, form_data (JSON), params (JSON), auth_type, auth_token
- **examples**: id, request_id, name, request_data (JSON), response_data (JSON)
- **environments**: id, user_id, name, variables (JSON), is_active
- **users**: id, email
- **sessions**: token, user_id, expires_at

All IDs are UUIDs. JSON data stored as TEXT/LONGTEXT.

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/login` | POST | Login (email @emonster.ca, password 7777) |
| `/api/auth/logout` | POST | Logout |
| `/api/auth/me` | GET | Verify token |
| `/api/collections` | CRUD | Collections |
| `/api/requests` | CRUD | HTTP requests |
| `/api/examples` | CRUD | Saved responses |
| `/api/environments` | CRUD | Environment variables |
| `/api/environments/:id/activate` | PUT | Set active env |
| `/api/proxy` | POST | Forward HTTP requests |
| `/api/sync/export` | GET | Export as Postman |
| `/api/sync/import` | POST | Import Postman collection |

## CSS Design System

Uses CSS variables for theming (light/dark):

```css
/* Key variables */
--bg-primary, --bg-secondary, --bg-tertiary, --bg-input, --bg-hover
--text-primary, --text-secondary, --text-tertiary
--border-primary, --border-secondary, --border-focus
--accent-primary, --accent-success, --accent-warning, --accent-danger
--font-sans: 'IBM Plex Sans'
--font-mono: 'JetBrains Mono'
--radius-sm/md/lg, --shadow-sm/md/lg, --space-1 through --space-10
```

## Coding Conventions

- ES6 modules (import/export)
- Functional components with hooks
- camelCase for JS variables/functions
- PascalCase for React components
- snake_case for database columns
- No TypeScript - JavaScript only
- Minimal comments (self-documenting code)

## Key Features

1. **Request Builder**: Method, URL, headers, body (JSON/raw/form-data), params, auth
2. **Response Viewer**: Status, headers, body with JSON syntax highlighting
3. **Examples**: Save request/response pairs
4. **Environments**: Variable substitution with `{{variable}}`
5. **Real-time Sync**: WebSocket broadcasts changes to all clients
6. **Import/Export**: Postman v2.1 collection format
7. **cURL Import**: Parse cURL commands
8. **Theme**: Light/dark mode toggle
9. **Tabs**: Multi-tab with dirty state and conflict detection

## Common Tasks

### Adding a new API endpoint
1. Create route in `server/routes/`
2. Register in `server/index.js`
3. Add client method in `src/api/client.js`
4. Broadcast WebSocket event if needed

### Adding a new component
1. Create in `src/components/`
2. Add styles to `src/App.css` (follow existing patterns)
3. Use CSS variables for colors/spacing

### Database changes
- Schema auto-creates on startup via `db.js`
- Add ALTER TABLE statements for new columns on existing tables

## Notes

- Email domain restriction configurable via VITE_EMAIL_DOMAIN env variable (e.g., @emonster.ca). Leave empty to allow any email.
- All HTTP requests proxied through backend to bypass CORS
- File uploads encoded as base64 in form-data
- Timestamps are Unix seconds (not milliseconds)
