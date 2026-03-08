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
