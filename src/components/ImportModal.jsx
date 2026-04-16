import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, FileJson } from 'lucide-react';
import { runImport } from '../utils/import/index.js';
import * as data from '../data/index.js';

const FORMATS = [
  { value: 'postman-v2.1', title: 'Postman', subtitle: 'Postman Collection v2.1 or v2.0 JSON' },
  { value: 'insomnia-v4', title: 'Insomnia', subtitle: 'Insomnia v4 export JSON' },
  { value: 'post-umbrella', title: 'Post Umbrella', subtitle: 'A collection exported from this tool' },
  { value: 'openapi-3', title: 'OpenAPI / Swagger', subtitle: 'OpenAPI 3.x or Swagger 2.x (.json, .yaml, .yml)' },
];

function detectedLabel(detected) {
  const match = FORMATS.find((f) => f.value === detected);
  return match ? match.title : detected;
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function countItems(items) {
  let folders = 0;
  let requests = 0;
  if (!Array.isArray(items)) return { folders, requests };
  for (const item of items) {
    if (item && Array.isArray(item.item)) {
      folders += 1;
      const nested = countItems(item.item);
      folders += nested.folders;
      requests += nested.requests;
    } else if (item && item.request) {
      requests += 1;
    }
  }
  return { folders, requests };
}

export function ImportModal({ open, onClose, onCommit, userConfig, setUserConfig }) {
  const [step, setStep] = useState('format');
  const [format, setFormat] = useState(userConfig?.lastImportFormat || 'postman-v2.1');
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const resetAll = useCallback(() => {
    setStep('format');
    setFormat(userConfig?.lastImportFormat || 'postman-v2.1');
    setRawText('');
    setFileName('');
    setFileSize(0);
    setResult(null);
    setError(null);
    setBusy(false);
  }, [userConfig?.lastImportFormat]);

  useEffect(() => {
    if (open) {
      setStep('format');
      setFormat(userConfig?.lastImportFormat || 'postman-v2.1');
      setRawText('');
      setFileName('');
      setFileSize(0);
      setResult(null);
      setError(null);
      setBusy(false);
    }
  }, [open, userConfig?.lastImportFormat]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = useCallback(() => {
    resetAll();
    onClose?.();
  }, [onClose, resetAll]);

  const readFile = useCallback(async (file) => {
    if (!file) return;
    setFileName(file.name);
    setFileSize(file.size);
    const text = await file.text();
    setRawText(text);
  }, []);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await readFile(file);
    e.target.value = '';
  }, [readFile]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) await readFile(file);
  }, [readFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const runPreview = useCallback(async (overrideFormat, overrideRawText) => {
    const fmt = overrideFormat || format;
    const txt = overrideRawText || rawText;
    if (!txt) return;
    setBusy(true);
    try {
      const res = await runImport(fmt, txt);
      if (res.ok) {
        setResult(res);
        setError(null);
        setStep('preview');
      } else {
        setError(res.error || { kind: 'parse', message: 'Unknown error' });
        setResult(null);
        setStep('error');
      }
    } catch (err) {
      setError({ kind: 'parse', message: err?.message || String(err) });
      setResult(null);
      setStep('error');
    } finally {
      setBusy(false);
    }
  }, [format, rawText]);

  const commit = useCallback(async () => {
    if (!result?.normalized) return;
    try {
      const updated = await data.updateUserConfig({ lastImportFormat: format });
      setUserConfig?.(updated);
    } catch {
      // non-fatal: persistence is best-effort
    }
    onCommit?.({ normalized: result.normalized, clientWarnings: result.warnings || [] });
    handleClose();
  }, [result, format, onCommit, setUserConfig, handleClose]);

  const summary = useMemo(() => {
    if (!result?.normalized) return null;
    const normalized = result.normalized;
    const collectionName = normalized?.info?.name || 'Collection';
    const { folders: folderCount, requests: requestCount } = countItems(normalized?.item);
    const variableCount = Array.isArray(normalized?.variable) ? normalized.variable.length : 0;
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    return { collectionName, folderCount, requestCount, variableCount, warnings };
  }, [result]);

  if (!open) return null;

  const errorDisplay = (() => {
    if (!error) return '';
    if (error.kind === 'parse') {
      return error.message || 'Could not parse the file as JSON.';
    }
    if (error.kind === 'shape') {
      const chosen = detectedLabel(format);
      const detected = error.detected && error.detected !== 'unknown'
        ? detectedLabel(error.detected)
        : 'something else';
      return error.reason || `This file does not look like ${chosen}. It appears to be ${detected}.`;
    }
    if (error.kind === 'schema') {
      return error.message || `The file did not match the ${detectedLabel(format)} schema.`;
    }
    return error.message || 'Import failed.';
  })();

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal import-modal"
        onClick={(e) => e.stopPropagation()}
        data-testid="import-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2><FileJson size={18} /> Import Collection</h2>
          <button className="modal-close" onClick={handleClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {step === 'format' && (
            <div className="import-format-picker">
              <p className="import-format-hint">Pick the source of your collection file.</p>
              {FORMATS.map((f) => (
                <label
                  key={f.value}
                  className={`import-format-option ${format === f.value ? 'active' : ''} ${f.disabled ? 'disabled' : ''}`}
                  data-testid={`import-format-${f.value}`}
                >
                  <input
                    type="radio"
                    name="import-format"
                    value={f.value}
                    checked={format === f.value}
                    disabled={f.disabled}
                    onChange={() => setFormat(f.value)}
                  />
                  <div className="import-format-label">
                    <span className="import-format-title">{f.title}</span>
                    <span className="import-format-subtitle">{f.subtitle}</span>
                  </div>
                </label>
              ))}
              <div className="import-modal-actions">
                <button className="btn-secondary" onClick={handleClose}>Cancel</button>
                <button
                  className="btn-primary"
                  onClick={() => setStep('file')}
                  disabled={!format || FORMATS.find((f) => f.value === format)?.disabled}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 'file' && (
            <div className="import-file-step">
              <div
                className="import-dropzone"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={triggerFilePicker}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') triggerFilePicker(); }}
              >
                <p>Drop your file here, or click to browse.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={format === 'openapi-3' ? '.json,.yaml,.yml' : '.json'}
                  style={{ display: 'none' }}
                  data-testid="import-file-input"
                  onChange={handleFileChange}
                />
              </div>
              {fileName && (
                <div className="import-file-info">
                  Selected: <strong>{fileName}</strong> ({formatSize(fileSize)})
                </div>
              )}
              <div className="import-modal-actions">
                <button className="btn-secondary" onClick={() => setStep('format')}>Back</button>
                <button
                  className="btn-primary"
                  onClick={() => runPreview()}
                  disabled={!rawText || busy}
                >
                  {busy ? 'Checking…' : 'Preview'}
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && summary && (
            <div className="import-preview-step">
              <div className="import-preview-summary" data-testid="import-preview-summary">
                Will create collection <strong>{summary.collectionName}</strong> with{' '}
                {summary.folderCount} folder{summary.folderCount === 1 ? '' : 's'},{' '}
                {summary.requestCount} request{summary.requestCount === 1 ? '' : 's'},{' '}
                {summary.variableCount} variable{summary.variableCount === 1 ? '' : 's'}.
                {summary.warnings.length > 0 && (
                  <> {summary.warnings.length} warning{summary.warnings.length === 1 ? '' : 's'}.</>
                )}
              </div>
              {summary.warnings.length > 0 && (
                <details className="import-preview-warnings" data-testid="import-preview-warnings">
                  <summary>Warnings ({summary.warnings.length})</summary>
                  <ul>
                    {summary.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}
              <div className="import-modal-actions">
                <button className="btn-secondary" onClick={() => setStep('file')}>Back</button>
                <button
                  className="btn-primary"
                  data-testid="import-commit"
                  onClick={commit}
                >
                  Import
                </button>
              </div>
            </div>
          )}

          {step === 'error' && error && (
            <div className="import-error-step" data-testid="import-error">
              <p className="import-error-message">{errorDisplay}</p>
              {error.kind === 'schema' && Array.isArray(error.errors) && error.errors.length > 0 && (
                <ul className="import-error-list">
                  {error.errors.map((e, i) => (
                    <li key={i}>
                      <code>{e.path || '(root)'}</code>: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {error.kind === 'shape' && error.detected && error.detected !== 'unknown' && (
                <div className="import-error-swap">
                  <button
                    className="btn-primary"
                    data-testid={`import-switch-format-${error.detected}`}
                    onClick={() => {
                      setFormat(error.detected);
                      runPreview(error.detected, rawText);
                    }}
                  >
                    Switch to {detectedLabel(error.detected)}
                  </button>
                </div>
              )}
              <div className="import-modal-actions">
                <button className="btn-secondary" onClick={() => setStep('file')}>Try another file</button>
                <button className="btn-secondary" onClick={() => setStep('format')}>Pick a different format</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
