# Acceptance Spec: Error Boundary

## Feature
Global React error boundary + WebSocket connection status indicator.

## Components

### 1. ErrorBoundary (class component)
- **Location:** `src/components/ErrorBoundary.jsx`
- Wraps `<App />` in `main.jsx`
- Catches render errors via `componentDidCatch`
- Fallback UI:
  - Centered card with error icon, "Something went wrong" heading
  - "Reload" button that calls `window.location.reload()`
  - In development: show component stack trace
- `data-testid="error-boundary-fallback"` on the fallback root
- `data-testid="error-boundary-reload"` on the reload button
- Matches the app's design system (CSS variables, fonts)

### 2. ConnectionStatus indicator
- **Location:** `src/components/ConnectionStatus.jsx`
- Renders a slim banner at the top of the app when disconnected/reconnecting
- States: `connected` (hidden), `reconnecting` (yellow banner), `disconnected` (red banner)
- `data-testid="connection-status"` on the banner
- Auto-hides 2 seconds after reconnection succeeds

### 3. useWebSocket changes
- **File:** `src/hooks/useWebSocket.js`
- Expose connection status: `{ connected, reconnecting }`
- Return object instead of just wsRef
- Track state transitions: connected → disconnected → reconnecting → connected

## Interface Contract

```jsx
// ErrorBoundary
<ErrorBoundary>
  <App />
</ErrorBoundary>

// ConnectionStatus — used inside AppContent
<ConnectionStatus connected={wsConnected} reconnecting={wsReconnecting} />

// useWebSocket — updated return value
const { wsRef, connected, reconnecting } = useWebSocket(onMessage);
```

## Business Rules
- ErrorBoundary only catches React render errors (not async/event handler errors)
- Connection banner must not block interaction (position: sticky or fixed, small height)
- Banner shows "Reconnecting..." with subtle animation when reconnecting
- Banner shows "Connection lost" when disconnected for >5 seconds
- When connection restores, banner briefly shows "Connected" then fades out

## Test IDs
- `error-boundary-fallback` — fallback UI root
- `error-boundary-reload` — reload button
- `connection-status` — connection banner

## Out of Scope
- Supabase API error message improvements (separate concern)
- Error logging/telemetry service
- Retry logic for failed API calls
