import { useRef } from 'react';
import { useToast } from './Toast';

export function ImportExport({ onImport, disabled }) {
  const toast = useToast();
  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      onImport(data);
    } catch (error) {
      toast.error('Failed to parse file: ' + error.message);
    }

    // Reset input
    e.target.value = '';
  };

  return (
    <div className="import-export">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        disabled={disabled}
      />
      <button
        className="btn-import"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        title={disabled ? 'Select a workspace first' : 'Import collection'}
      >
        Import
      </button>
    </div>
  );
}
