import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const METHOD_COLORS = {
  GET: '#10b981',
  POST: '#f59e0b',
  PUT: '#3b82f6',
  PATCH: '#8b5cf6',
  DELETE: '#ef4444',
  HEAD: '#06b6d4',
  OPTIONS: '#71717a',
};

export function MethodSelector({ value, onChange, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (method) => {
    onChange(method);
    setIsOpen(false);
  };

  return (
    <div className="method-selector" ref={containerRef}>
      <button
        type="button"
        className="method-selector-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{ '--method-color': METHOD_COLORS[value] }}
        disabled={disabled}
      >
        <span className="method-selector-badge">{value}</span>
        <ChevronDown size={14} className={`method-selector-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="method-selector-dropdown">
          {METHODS.map((method) => (
            <button
              key={method}
              type="button"
              className={`method-selector-option ${method === value ? 'selected' : ''}`}
              onClick={() => handleSelect(method)}
              style={{ '--method-color': METHOD_COLORS[method] }}
            >
              <span className="method-selector-option-dot" />
              <span className="method-selector-option-text">{method}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
