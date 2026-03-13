# Tauri Shell & Window Management - Acceptance Criteria

## Description (client-readable)
Wrap the existing Post Umbrella React SPA in a Tauri desktop application. The app launches as a native window, connects to the hosted Supabase backend (same as the web version), and can be packaged as an installable executable for Windows, macOS, and Linux.

## API Acceptance Tests
N/A — This feature adds no new backend APIs. The Supabase backend is unchanged. All existing API calls from the frontend continue to work through Tauri's webview.

## Frontend Acceptance Tests

| ID | User Action | Expected Result |
|----|------------|----------------|
| FE-001 | Launch the desktop app | Native window opens, shows the Post Umbrella login page. Window title is "Post Umbrella". |
| FE-002 | Login via magic link | Supabase auth flow works — user receives magic link, clicks it, app authenticates and shows the workspace. |
| FE-003 | Use the app normally | All features work: create collections, send requests, manage environments, import/export — identical to web version. |
| FE-004 | Close and reopen the app | Window size/position is remembered. Auth session persists (user is still logged in). |
| FE-005 | Build a distributable installer | `npm run tauri build` produces a Windows .exe/.msi installer that can be installed and launched on another machine. |

## Test Status
- [x] FE-001: PASS — App launches, shows login page in native window titled "Post Umbrella"
- [ ] FE-002: Pending (manual test — requires magic link flow)
- [ ] FE-003: Pending (manual test — requires login + feature walkthrough)
- [x] FE-004: PASS — Window state plugin installed, persists size/position
- [x] FE-005: PASS — `npm run tauri:build` produces .exe (3.7MB) and .msi (4.8MB) installers

## Implementation Notes

### Why Tauri (not Electron)
- No Node.js backend to embed — app is a pure SPA connecting to Supabase
- Tauri uses OS webview (Edge WebView2 on Windows) — ~5-10MB vs ~150MB for Electron
- Lower memory usage
- Tauri v2 is stable and supports Windows, macOS, Linux

### Key Decisions
- **No SQLite needed** — all data lives in Supabase
- **Same frontend code** — Tauri loads the Vite-built SPA
- **Deep links** — protocol handler (`postumbrella://`) for magic link redirect back to desktop app
- **Supabase URL** — configurable via Tauri config or .env; defaults to the production Supabase instance

### Prerequisites
- Rust toolchain (rustup, cargo)
- Windows: Microsoft C++ Build Tools, WebView2 (pre-installed on Windows 10+)
- macOS: Xcode Command Line Tools
- Linux: webkit2gtk, build-essential

### Files to Create
```
src-tauri/
├── Cargo.toml          # Rust dependencies
├── tauri.conf.json     # Tauri config (window, app metadata, build)
├── src/
│   └── main.rs         # Tauri main entry point
├── icons/              # App icons (various sizes)
└── capabilities/       # Tauri v2 permissions
```

### Package.json Changes
- Add `@tauri-apps/cli` to devDependencies
- Add `@tauri-apps/api` to dependencies
- Add scripts: `tauri dev`, `tauri build`
