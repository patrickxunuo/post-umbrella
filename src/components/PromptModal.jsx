import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Edit3, X } from 'lucide-react';

const PromptContext = createContext(null);

export function usePrompt() {
  const context = useContext(PromptContext);
  if (!context) {
    throw new Error('usePrompt must be used within a PromptProvider');
  }
  return context;
}

export function PromptProvider({ children }) {
  const [state, setState] = useState({
    isOpen: false,
    title: '',
    message: '',
    defaultValue: '',
    placeholder: '',
    confirmText: 'OK',
    cancelText: 'Cancel',
    resolve: null,
  });

  const prompt = useCallback(({
    title = 'Enter Value',
    message = '',
    defaultValue = '',
    placeholder = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
  }) => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        title,
        message,
        defaultValue,
        placeholder,
        confirmText,
        cancelText,
        resolve,
      });
    });
  }, []);

  const handleConfirm = (value) => {
    state.resolve?.(value);
    setState(prev => ({ ...prev, isOpen: false }));
  };

  const handleCancel = () => {
    state.resolve?.(null);
    setState(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {state.isOpen && (
        <PromptModal
          title={state.title}
          message={state.message}
          defaultValue={state.defaultValue}
          placeholder={state.placeholder}
          confirmText={state.confirmText}
          cancelText={state.cancelText}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </PromptContext.Provider>
  );
}

function PromptModal({
  title,
  message,
  defaultValue,
  placeholder,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  // Focus and select input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="prompt-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
      <div
        className="prompt-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
      >
        <div className="prompt-header">
          <div className="prompt-icon">
            <Edit3 size={20} />
          </div>
          <h3 id="prompt-title" className="prompt-title">{title}</h3>
          <button className="prompt-close" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="prompt-body">
            {message && <p className="prompt-message">{message}</p>}
            <input
              ref={inputRef}
              type="text"
              className="prompt-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
            />
          </div>

          <div className="prompt-footer">
            <button
              type="button"
              className="prompt-btn prompt-btn-cancel"
              onClick={onCancel}
            >
              {cancelText}
            </button>
            <button
              type="submit"
              className="prompt-btn prompt-btn-confirm"
              disabled={!value.trim()}
            >
              {confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
