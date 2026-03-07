import { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

const ConfirmContext = createContext(null);

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'default', // 'default' | 'danger'
    resolve: null,
  });

  const confirm = useCallback(({
    title = 'Confirm',
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'default',
  }) => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        title,
        message,
        confirmText,
        cancelText,
        variant,
        resolve,
      });
    });
  }, []);

  const handleConfirm = () => {
    state.resolve?.(true);
    setState(prev => ({ ...prev, isOpen: false }));
  };

  const handleCancel = () => {
    state.resolve?.(false);
    setState(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state.isOpen && (
        <ConfirmModal
          title={state.title}
          message={state.message}
          confirmText={state.confirmText}
          cancelText={state.cancelText}
          variant={state.variant}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({
  title,
  message,
  confirmText,
  cancelText,
  variant,
  onConfirm,
  onCancel,
}) {
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter') {
      onConfirm();
    }
  };

  return (
    <div className="confirm-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
      <div
        className={`confirm-modal ${variant === 'danger' ? 'confirm-danger' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="confirm-header">
          <div className="confirm-icon">
            {variant === 'danger' ? (
              <Trash2 size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
          </div>
          <h3 id="confirm-title" className="confirm-title">{title}</h3>
          <button className="confirm-close" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="confirm-body">
          <p className="confirm-message">{message}</p>
        </div>

        <div className="confirm-footer">
          <button
            className="confirm-btn confirm-btn-cancel"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            className={`confirm-btn confirm-btn-confirm ${variant === 'danger' ? 'confirm-btn-danger' : ''}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
