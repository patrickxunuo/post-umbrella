import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Terminal, FileJson } from 'lucide-react';

export function ImportDropdown({ onImportCurl, onOpenImportModal, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCurlClick = () => {
    setIsOpen(false);
    onImportCurl();
  };

  const handleCollectionClick = () => {
    setIsOpen(false);
    onOpenImportModal();
  };

  return (
    <div className="import-dropdown" ref={dropdownRef}>
      <button
        className="import-dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title={disabled ? 'Select a workspace first' : 'Import'}
      >
        Import
        <ChevronDown size={14} className={`import-dropdown-chevron ${isOpen ? 'open' : ''}`} />
      </button>
      {isOpen && (
        <div className="import-dropdown-menu">
          <button className="import-dropdown-item" onClick={handleCollectionClick} disabled={disabled}>
            <FileJson size={14} />
            Import Collection
          </button>
          <button className="import-dropdown-item" onClick={handleCurlClick}>
            <Terminal size={14} />
            From cURL
          </button>
        </div>
      )}
    </div>
  );
}
