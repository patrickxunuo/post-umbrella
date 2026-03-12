import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Terminal, FileJson } from 'lucide-react';
import { useToast } from './Toast';

export function ImportDropdown({ onImportCurl, onImportFile, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      onImportFile(data);
    } catch (error) {
      toast.error('Failed to parse file: ' + error.message);
    }

    e.target.value = '';
    setIsOpen(false);
  };

  const handleCurlClick = () => {
    setIsOpen(false);
    onImportCurl();
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="import-dropdown" ref={dropdownRef}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        disabled={disabled}
      />
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
          <button className="import-dropdown-item" onClick={handleCurlClick}>
            <Terminal size={14} />
            cURL
          </button>
          <button className="import-dropdown-item" onClick={handleFileClick} disabled={disabled}>
            <FileJson size={14} />
            Collection File
          </button>
        </div>
      )}
    </div>
  );
}
