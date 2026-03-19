import { useState } from 'react';
import { X, Terminal } from 'lucide-react';

// Parse cURL command
export function parseCurl(curlCommand) {
  const result = {
    method: 'GET',
    url: '',
    headers: [],
    body: '',
    bodyType: 'none',
    formData: [],
  };

  // Remove newlines and extra spaces, handle line continuations
  let cmd = curlCommand
    .replace(/\\\n/g, ' ')
    .replace(/\\\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove 'curl' prefix
  if (cmd.toLowerCase().startsWith('curl ')) {
    cmd = cmd.slice(5).trim();
  }

  // Tokenize respecting quotes
  const tokens = [];
  let current = '';
  let inQuote = null;
  let escape = false;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  // Parse tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '-X' || token === '--request') {
      result.method = tokens[++i]?.toUpperCase() || 'GET';
    } else if (token === '-H' || token === '--header') {
      const header = tokens[++i];
      if (header) {
        const colonIndex = header.indexOf(':');
        if (colonIndex > 0) {
          result.headers.push({
            key: header.slice(0, colonIndex).trim(),
            value: header.slice(colonIndex + 1).trim(),
            enabled: true,
          });
        }
      }
    } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
      result.body = tokens[++i] || '';
      result.bodyType = 'raw';
      // Check if it looks like JSON
      if (result.body.trim().startsWith('{') || result.body.trim().startsWith('[')) {
        result.bodyType = 'json';
      }
      // If body is provided, default to POST if method is still GET
      if (result.method === 'GET') {
        result.method = 'POST';
      }
    } else if (token === '-F' || token === '--form') {
      const formField = tokens[++i] || '';
      const eqIndex = formField.indexOf('=');
      if (eqIndex > 0) {
        const key = formField.slice(0, eqIndex);
        let val = formField.slice(eqIndex + 1);
        if (val.startsWith('@')) {
          result.formData.push({ key, value: '', type: 'file', enabled: true });
        } else {
          result.formData.push({ key, value: val, type: 'text', enabled: true });
        }
      }
      result.bodyType = 'form-data';
      if (result.method === 'GET') {
        result.method = 'POST';
      }
    } else if (token === '--location' || token === '--compressed' || token === '-L') {
      // Skip flags we don't need
    } else if (!token.startsWith('-') && !result.url) {
      result.url = token;
    }
  }

  // Add empty rows for editing
  result.headers.push({ key: '', value: '', enabled: true });
  if (result.formData.length > 0) {
    result.formData.push({ key: '', value: '', type: 'text', enabled: true });
  }

  return result;
}

export function ImportCurlModal({ onImport, onClose }) {
  const [curlCommand, setCurlCommand] = useState('');
  const [error, setError] = useState('');

  const handleImport = () => {
    if (!curlCommand.trim()) {
      setError('Please enter a cURL command');
      return;
    }

    try {
      const parsed = parseCurl(curlCommand);
      if (!parsed.url) {
        setError('Could not parse URL from cURL command');
        return;
      }
      onImport(parsed);
      onClose();
    } catch (err) {
      setError('Failed to parse cURL command: ' + err.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-curl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Terminal size={18} /> Import cURL</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-hint">
            Paste a cURL command to create a temporary request. This request will not be saved to the database.
          </p>

          <textarea
            className="curl-input"
            placeholder="curl https://api.example.com/endpoint"
            value={curlCommand}
            onChange={(e) => {
              setCurlCommand(e.target.value);
              setError('');
            }}
            rows={8}
          />

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleImport}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
