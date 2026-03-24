import { useState, useEffect, createContext, useContext, useCallback } from 'react';

const ToastContext = createContext(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 5000, action = null) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type, action }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (message, duration) => addToast(message, 'success', duration),
    error: (message, duration) => addToast(message, 'error', duration ?? 8000),
    warning: (message, duration) => addToast(message, 'warning', duration),
    info: (message, duration) => addToast(message, 'info', duration),
    loading: (message) => addToast(message, 'loading', 0), // duration 0 = no auto-dismiss
    action: (message, { label, onClick, duration = 10000 } = {}) =>
      addToast(message, 'info', duration, { label, onClick }),
    dismiss: (id) => removeToast(id),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onRemove={() => onRemove(toast.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onRemove }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleRemove = () => {
    setIsExiting(true);
    setTimeout(onRemove, 200);
  };

  return (
    <div className={`toast toast-${toast.type} ${isExiting ? 'toast-exit' : ''}`}>
      <span className="toast-icon">
        {toast.type === 'success' && '✓'}
        {toast.type === 'error' && '✕'}
        {toast.type === 'warning' && '⚠'}
        {toast.type === 'info' && 'ℹ'}
        {toast.type === 'loading' && <span className="toast-spinner" />}
      </span>
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button className="toast-action" onClick={() => { toast.action.onClick?.(); handleRemove(); }}>
          {toast.action.label}
        </button>
      )}
      {toast.type !== 'loading' && (
        <button className="toast-close" onClick={handleRemove}>×</button>
      )}
    </div>
  );
}
