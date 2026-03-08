import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Type, FileText } from 'lucide-react';

const TYPES = [
  { value: 'text', label: 'Text', icon: Type },
  { value: 'file', label: 'File', icon: FileText },
];

export function TypeSelector({ value, onChange }) {
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

  const handleSelect = (type) => {
    onChange(type);
    setIsOpen(false);
  };

  const currentType = TYPES.find(t => t.value === value) || TYPES[0];
  const Icon = currentType.icon;

  return (
    <div className="type-selector" ref={containerRef}>
      <button
        type="button"
        className="type-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="type-selector-icon">
          <Icon size={12} />
        </span>
        <span className="type-selector-value">{currentType.label}</span>
        <ChevronDown size={12} className={`type-selector-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="type-selector-dropdown">
          {TYPES.map((type) => {
            const TypeIcon = type.icon;
            return (
              <button
                key={type.value}
                type="button"
                className={`type-selector-option ${type.value === value ? 'selected' : ''}`}
                onClick={() => handleSelect(type.value)}
              >
                <span className="type-selector-option-icon">
                  <TypeIcon size={12} />
                </span>
                <span className="type-selector-option-text">{type.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
