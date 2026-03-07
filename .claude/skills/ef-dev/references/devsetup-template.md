# devSetup.md Template

Use this structure when creating `memory-bank/devSetup.md`. Replace `[...]` placeholders with actual values discovered during exploration.

```markdown
# Dev Environment Setup

## Prerequisites
- [tool] [version] — [install hint or link]
- ...

## First-Time Setup

Run these steps once after cloning:

### 1. Install Dependencies
```
[exact commands]
```

### 2. Environment Files
```
[copy commands, list of env vars to fill in]
```

Required secrets (ask team for values):
- `DATABASE_URL` — [description]
- `API_KEY` — [description]
- ...

### 3. Database Setup
```
[migration and seed commands]
```

### 4. Verify Setup
```
[build or compile check command]
[test command]
```

## Quick Start

Run these to start the dev environment (after first-time setup is done):

### Start Order
1. [service] — `[command]` (port XXXX)
2. [service] — `[command]` (port XXXX)
3. ...

### All-in-One (if available)
```
[docker-compose up / make dev / etc.]
```

### Verify Running
- Backend: http://localhost:XXXX/health
- Frontend: http://localhost:XXXX
- ...

## Stop

```
[stop commands]
```

## Troubleshooting

### [Common issue 1]
[Symptom] → [Fix]

### [Common issue 2]
[Symptom] → [Fix]

## Last Verified
[date] — [which OS/environment]
```
