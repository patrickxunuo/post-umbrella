// Capture auth hash before Supabase SDK clears it (must be before any imports that init Supabase)
if (window.location.pathname === '/auth/callback' && window.location.hash.includes('access_token')) {
  window.__AUTH_CALLBACK_HASH__ = window.location.hash.substring(1);
}

// Mark as desktop app for CSS scoping
if ('__TAURI_INTERNALS__' in window) {
  document.documentElement.classList.add('tauri');
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { ConfirmProvider } from './components/ConfirmModal.jsx'
import { PromptProvider } from './components/PromptModal.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <PromptProvider>
          <App />
        </PromptProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
)
