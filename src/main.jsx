// Capture deep link auth tokens for desktop app (Supabase's detectSessionInUrl is unreliable after signout)
if ('__TAURI_INTERNALS__' in window && window.location.hash.includes('access_token') && window.location.pathname !== '/auth/callback') {
  const params = new URLSearchParams(window.location.hash.substring(1));
  window.__DEEP_LINK_AUTH__ = {
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
  };
}

// Capture UI state transferred from web via deep link (don't apply yet — prompt user first)
if (window.location.hash.includes('_t=') || window.location.hash.includes('_ec=')) {
  try {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const tabIds = params.get('_t');
    const activeTab = params.get('_at');
    const expandedC = params.get('_ec');
    const expandedR = params.get('_er');

    if (tabIds || expandedC || expandedR) {
      window.__DESKTOP_TRANSFER__ = {
        tabIds: tabIds ? tabIds.split(',').filter(Boolean) : [],
        activeTabId: activeTab || null,
        expandedCollections: expandedC ? expandedC.split(',').filter(Boolean) : [],
        expandedRequests: expandedR ? expandedR.split(',').filter(Boolean) : [],
      };
    }
  } catch (e) {
    // Ignore parse errors — auth tokens still work fine
  }
}

// Mark as desktop app + platform for CSS scoping
if ('__TAURI_INTERNALS__' in window) {
  document.documentElement.classList.add('tauri');
  if (navigator.platform?.startsWith('Mac') || /macintosh|mac os/i.test(navigator.userAgent)) {
    document.documentElement.classList.add('tauri-mac');
  }
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
