# System Patterns

## Project Structure

```
post-umbrella/
├── src/                      # React frontend
│   ├── components/           # React components
│   ├── hooks/                # Custom React hooks
│   ├── api/                  # API client functions
│   ├── utils/                # Utility functions
│   ├── App.jsx               # Main app component
│   ├── App.css               # Global styles
│   └── main.jsx              # Entry point
├── server/                   # Express backend
│   ├── routes/               # API route handlers
│   ├── db.js                 # Database connection and schema
│   └── index.js              # Server entry point
├── dist/                     # Production build output
└── memory-bank/              # Project memory (this folder)
```

## Naming Conventions
- Files: PascalCase for components (`RequestEditor.jsx`), camelCase for utilities (`scriptRunner.js`)
- Functions/methods: camelCase
- React components: PascalCase
- Database tables/columns: snake_case
- CSS classes: kebab-case

## Code Patterns

### API Client Pattern
All API calls go through `src/api/client.js` which:
- Adds auth token header automatically
- Handles 401 responses by logging out user
- Provides typed functions for each endpoint

### Component State Pattern
- Complex state in `App.jsx`, passed down as props
- Local UI state in individual components
- `useState` for simple state, `useCallback` for memoized handlers

### Real-time Sync Pattern
- WebSocket connection established on app load (`useWebSocket` hook)
- Backend broadcasts events on data changes
- Frontend refreshes relevant data when receiving events

### Database Pattern
- Raw SQL with parameterized queries (no ORM)
- UUIDs for primary keys
- Timestamps stored as Unix epoch integers
- JSON stored as TEXT/LONGTEXT columns

## API Conventions
- RESTful endpoints under `/api/`
- JSON request/response bodies
- Auth via Bearer token in Authorization header
- Standard HTTP status codes (200, 201, 400, 401, 404, 500)

## Known Pitfalls
- MySQL `ON DUPLICATE KEY UPDATE` syntax differs from PostgreSQL
- `UNIX_TIMESTAMP()` is MySQL-specific
- WebSocket connections drop when server restarts
- Large file uploads encoded as base64 in JSON body
