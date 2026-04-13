import { useState, useMemo, useEffect } from 'react';
import { Monitor, Download, Terminal } from 'lucide-react';
import JsonView from '@uiw/react-json-view';
import { JsonEditor } from './JsonEditor';

const isHtmlResponse = (headers) => {
  if (!Array.isArray(headers)) return false;
  return headers.some(
    (h) => h.key?.toLowerCase() === 'content-type' && h.value?.includes('text/html')
  );
};

// Matches image/png, image/jpeg, image/gif, image/webp, image/svg+xml, image/bmp, image/x-icon, image/avif, etc.
const getImageMimeType = (headers) => {
  if (!Array.isArray(headers)) return null;
  const ct = headers.find(h => h.key?.toLowerCase() === 'content-type')?.value;
  if (!ct) return null;
  const match = ct.match(/^\s*(image\/[^;\s]+)/i);
  return match ? match[1].toLowerCase() : null;
};

// body may be a data URL, a base64 string, a raw-binary string (lossy utf-8 decoded),
// or an SVG source. Returns a valid <img> src for any of these.
function buildImageSrc(body, mimeType) {
  if (typeof body !== 'string' || !body || !mimeType) return '';
  if (body.startsWith('data:')) return body;
  // SVG is text — inline it so it doesn't need base64 decoding
  if (mimeType === 'image/svg+xml' && body.trim().startsWith('<')) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(body)}`;
  }
  const cleaned = body.replace(/\s+/g, '');
  // Already base64? (only base64 alphabet chars)
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) && cleaned.length % 4 === 0) {
    return `data:${mimeType};base64,${cleaned}`;
  }
  // Raw-binary string (each char code is a byte): re-encode as base64.
  try {
    return `data:${mimeType};base64,${btoa(body)}`;
  } catch {
    return '';
  }
}

const isTauri = () => '__TAURI_INTERNALS__' in window;

const isLocalOrPrivateUrl = (url) => {
  if (!url) return false;
  try {
    let urlToParse = url;
    if (!url.match(/^https?:\/\//i)) urlToParse = 'http://' + url;
    const parsed = new URL(urlToParse);
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (hostname.endsWith('.local') || hostname.endsWith('.test') || hostname.endsWith('.localhost')) return true;
    // Private IP ranges
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => !isNaN(p))) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
    }
    return false;
  } catch {
    return false;
  }
};

export function ResponseViewer({ response, loading, isExample, example, onExampleChange, requestUrl }) {
  const [activeTab, setActiveTab] = useState('body');
  const [htmlViewMode, setHtmlViewMode] = useState('preview');

  // For examples, use example.response_data
  const displayResponse = isExample ? example?.response_data : response;

  // Reset htmlViewMode to 'preview' when displayResponse changes
  useEffect(() => {
    setHtmlViewMode('preview');
  }, [displayResponse]);

  // Parse JSON body - must be before any early returns!
  const jsonBody = useMemo(() => {
    const body = displayResponse?.body;
    if (typeof body === 'object' && body !== null) return body;
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    }
    return null;
  }, [displayResponse?.body]);

  const isJsonBody = jsonBody !== null;

  const isHtmlBody = useMemo(() => {
    return !isExample && !isJsonBody && isHtmlResponse(displayResponse?.headers);
  }, [isExample, isJsonBody, displayResponse?.headers]);

  const imageMimeType = useMemo(() => {
    if (isExample) return null;
    return getImageMimeType(displayResponse?.headers);
  }, [isExample, displayResponse?.headers]);
  const isImageBody = !!imageMimeType;

  if (loading) {
    return (
      <div className="response-viewer loading">
        <div className="loading-spinner"></div>
        <p>Sending request...</p>
      </div>
    );
  }

  if (!displayResponse && !isExample) {
    return (
      <div className="response-viewer empty">
        <p>Send a request to see the response</p>
      </div>
    );
  }

  if (isExample && !displayResponse) {
    return (
      <div className="response-viewer empty example-response">
        <p>No response data for this example</p>
        <p className="hint">Edit the response fields below</p>
        <div className="example-response-form">
          <div className="form-row">
            <label>Status Code:</label>
            <input
              type="number"
              placeholder="200"
              value=""
              onChange={(e) => {
                onExampleChange?.({
                  response_data: {
                    status: parseInt(e.target.value) || 0,
                    statusText: '',
                    body: '',
                    headers: [],
                  }
                });
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  const getStatusClass = (status) => {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client-error';
    if (status >= 500) return 'server-error';
    return 'error';
  };

  const formatBody = (body) => {
    if (typeof body === 'object') {
      return JSON.stringify(body, null, 2);
    }
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleStatusChange = (e) => {
    if (!isExample) return;
    const newStatus = parseInt(e.target.value) || 0;
    onExampleChange?.({
      response_data: {
        ...displayResponse,
        status: newStatus,
      }
    });
  };

  const handleBodyChange = (e) => {
    if (!isExample) return;
    onExampleChange?.({
      response_data: {
        ...displayResponse,
        body: e.target.value,
      }
    });
  };

  return (
    <div className="response-viewer">
      <div className="response-toolbar">
        <div className="response-tabs">
          <button
            className={activeTab === 'body' ? 'active' : ''}
            onClick={() => setActiveTab('body')}
          >
            Body
          </button>
          <button
            className={activeTab === 'headers' ? 'active' : ''}
            onClick={() => setActiveTab('headers')}
          >
            Headers
          </button>
          {/* Console tab moved to global bottom panel */}
        </div>
        <div className="response-meta">
          {isExample ? (
            <span className={`status ${getStatusClass(displayResponse?.status)}`}>
              <input
                type="number"
                className="status-input"
                value={displayResponse?.status || ''}
                onChange={handleStatusChange}
                placeholder="200"
              />
              <input
                type="text"
                className="status-text-input"
                value={displayResponse?.statusText || ''}
                onChange={(e) => {
                  onExampleChange?.({
                    response_data: {
                      ...displayResponse,
                      statusText: e.target.value,
                    }
                  });
                }}
                placeholder="OK"
              />
            </span>
          ) : (
            <span className={`status ${getStatusClass(displayResponse?.status)}`}>
              {displayResponse?.status} {displayResponse?.statusText}
            </span>
          )}
          <span className="time">{displayResponse?.time || 0} ms</span>
          <span className="size">{formatSize(displayResponse?.size || 0)}</span>
        </div>
      </div>

      <div className="response-content">
        {activeTab === 'body' && (
          isExample ? (
            <JsonEditor
              value={typeof displayResponse?.body === 'object'
                ? JSON.stringify(displayResponse?.body, null, 2)
                : (displayResponse?.body || '')}
              onChange={(val) => {
                onExampleChange?.({
                  response_data: {
                    ...displayResponse,
                    body: val,
                  }
                });
              }}
              placeholder="Enter response body (JSON)..."
              showBeautify={true}
              className="response-json-editor"
            />
          ) : isHtmlBody ? (
            <>
              <div className="option-selector html-view-toggle" data-testid="html-view-toggle">
                <button
                  className={htmlViewMode === 'preview' ? 'active' : ''}
                  onClick={() => setHtmlViewMode('preview')}
                  data-testid="html-preview-btn"
                >
                  Preview
                </button>
                <button
                  className={htmlViewMode === 'raw' ? 'active' : ''}
                  onClick={() => setHtmlViewMode('raw')}
                  data-testid="html-raw-btn"
                >
                  Raw
                </button>
              </div>
              {htmlViewMode === 'preview' ? (
                <iframe
                  className="html-preview-frame"
                  srcDoc={displayResponse?.body}
                  sandbox=""
                  data-testid="html-preview-frame"
                  title="HTML Preview"
                />
              ) : (
                <pre className="response-body" data-testid="html-raw-body">{displayResponse?.body}</pre>
              )}
            </>
          ) : isImageBody ? (
            <div className="image-preview-container" data-testid="image-preview-container">
              <img
                className="image-preview"
                src={buildImageSrc(displayResponse?.body, imageMimeType)}
                alt="Response image"
                data-testid="image-preview"
                onError={(e) => { e.currentTarget.dataset.failed = 'true'; }}
              />
            </div>
          ) : isJsonBody ? (
            <div className="json-view-wrapper">
              <JsonView
                value={jsonBody}
                displayDataTypes={false}
                collapsed={2}
                enableClipboard={true}
                style={{
                  '--w-rjv-font-family': 'var(--font-mono)',
                  '--w-rjv-background-color': 'var(--bg-secondary)',
                  '--w-rjv-color': 'var(--text-primary)',
                  '--w-rjv-key-string': '#0ea5e9',
                  '--w-rjv-type-string-color': '#22c55e',
                  '--w-rjv-type-int-color': '#f59e0b',
                  '--w-rjv-type-float-color': '#f59e0b',
                  '--w-rjv-type-boolean-color': '#8b5cf6',
                  '--w-rjv-type-null-color': '#ef4444',
                  '--w-rjv-arrow-color': 'var(--text-tertiary)',
                  '--w-rjv-brackets-color': 'var(--text-tertiary)',
                  '--w-rjv-ellipsis-color': 'var(--text-tertiary)',
                  '--w-rjv-curlybraces-color': 'var(--text-tertiary)',
                  '--w-rjv-colon-color': 'var(--text-tertiary)',
                  '--w-rjv-info-color': 'var(--text-tertiary)',
                  '--w-rjv-copied-color': 'var(--accent-success)',
                  '--w-rjv-copied-success-color': 'var(--accent-success)',
                  fontSize: '12px',
                  padding: 'var(--space-4)',
                }}
              />
            </div>
          ) : (
            <pre className="response-body">{formatBody(displayResponse?.body)}</pre>
          )
        )}

        {activeTab === 'body' && !isExample && displayResponse?.error && displayResponse?.status === 0 && !isTauri() && (isLocalOrPrivateUrl(requestUrl) || isLocalOrPrivateUrl(displayResponse?.resolvedUrl)) && (
          <div className="desktop-agent-banner">
            <div className="desktop-agent-banner-icon">
              <Monitor size={20} />
            </div>
            <div className="desktop-agent-banner-content">
              <strong>Can't send request from the browser</strong>
              <p>Requests to local and private URLs require the Post Umbrella desktop app.</p>
            </div>
            <a
              className="desktop-agent-banner-action"
              href="https://github.com/emonster-org/post-umbrella/releases"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download size={14} />
              Download Desktop App
            </a>
          </div>
        )}

        {activeTab === 'headers' && (
          <div className="response-headers">
            {displayResponse?.headers?.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {displayResponse.headers.map((header, index) => (
                    <tr key={index}>
                      <td>{header.key}</td>
                      <td>{header.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No headers</p>
            )}
          </div>
        )}

        {/* Console rendering moved to global ConsolePanel */}
      </div>
    </div>
  );
}
