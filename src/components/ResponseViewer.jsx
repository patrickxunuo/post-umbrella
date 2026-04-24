import { useState, useMemo, useEffect, useRef } from 'react';
import { Monitor, Download, Terminal, ChevronsUpDown, ChevronsDownUp, Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import JsonView from '@uiw/react-json-view';
import { JsonEditor } from './JsonEditor';
import { BinaryViewToggle } from './BinaryViewToggle';
import { useToast } from './Toast';
import { downloadResponse } from '../utils/downloadResponse';

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

const isPdfResponse = (headers) => {
  if (!Array.isArray(headers)) return false;
  const ct = headers.find(h => h.key?.toLowerCase() === 'content-type')?.value;
  return !!ct && /^\s*application\/pdf/i.test(ct);
};

// body may be a data URL, a base64 string, a raw-binary string (lossy utf-8 decoded),
// or an SVG source. Returns a valid data URL for any of these.
function buildBinaryDataUrl(body, mimeType) {
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

const HEX_VIEW_BYTE_CAP = 1024 * 1024; // 1 MB

// Decode body (base64 string OR raw-binary string) -> Uint8Array
function decodeToBytes(body) {
  if (typeof body !== 'string' || !body) return new Uint8Array();
  const cleaned = body.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) && cleaned.length % 4 === 0) {
    try {
      const bin = atob(cleaned);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch { /* fall through */ }
  }
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

// Render up to `byteLimit` bytes as `addr | hex | ascii` rows.
function buildHexDump(bytes, byteLimit = HEX_VIEW_BYTE_CAP) {
  const total = bytes.length;
  const cap = Math.min(total, byteLimit);
  const lines = [];
  for (let off = 0; off < cap; off += 16) {
    const slice = bytes.subarray(off, Math.min(off + 16, cap));
    const addr = off.toString(16).padStart(8, '0');
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    lines.push(`${addr}  ${hex}  ${ascii}`);
  }
  return { text: lines.join('\n'), truncated: total > cap, totalBytes: total };
}

// JSON search helpers — walk parsed JSON DFS and emit match entries.
// A match is { path, kind, text, start, length }.
const SEARCH_MATCH_CAP = 5000;

// Let users type quotes around a term the way they see it in the tree view
// (e.g. `"route_id"` matches the key `route_id`). Strip at most one leading
// and one trailing double-quote. Middle quotes are preserved.
function normalizeSearchQuery(raw) {
  if (!raw) return '';
  let q = raw;
  if (q.startsWith('"')) q = q.slice(1);
  if (q.length > 0 && q.endsWith('"')) q = q.slice(0, -1);
  return q;
}

function findJsonMatches(json, query) {
  if (!query) return [];
  const q = String(query).toLowerCase();
  if (!q) return [];
  const out = [];
  const pushMatches = (path, kind, text) => {
    if (out.length >= SEARCH_MATCH_CAP) return;
    const lower = text.toLowerCase();
    let cursor = 0;
    let idx;
    while ((idx = lower.indexOf(q, cursor)) !== -1) {
      out.push({ path: path.slice(), kind, text, start: idx, length: query.length });
      if (out.length >= SEARCH_MATCH_CAP) return;
      cursor = idx + q.length;
    }
  };
  const stringifyLeaf = (v) => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    try { return String(v); } catch { return ''; }
  };
  const walk = (node, path) => {
    if (out.length >= SEARCH_MATCH_CAP) return;
    if (node !== null && typeof node === 'object') {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          if (out.length >= SEARCH_MATCH_CAP) return;
          path.push(i);
          walk(node[i], path);
          path.pop();
        }
      } else {
        for (const key of Object.keys(node)) {
          if (out.length >= SEARCH_MATCH_CAP) return;
          pushMatches(path.concat(key), 'key', String(key));
          path.push(key);
          walk(node[key], path);
          path.pop();
        }
      }
    } else {
      // leaf
      pushMatches(path, 'value', stringifyLeaf(node));
    }
  };
  walk(json, []);
  return out;
}

function renderHighlightedText({ baseProps, text, query, kind }) {
  if (text == null) return null;
  const str = typeof text === 'string' ? text : String(text);
  if (!str) return null;
  const lower = str.toLowerCase();
  const q = (query || '').toLowerCase();
  if (!q || !lower.includes(q)) return null; // fall through to default
  const parts = [];
  let cursor = 0;
  let idx;
  while ((idx = lower.indexOf(q, cursor)) !== -1) {
    if (idx > cursor) parts.push({ t: str.slice(cursor, idx), hit: false });
    parts.push({ t: str.slice(idx, idx + q.length), hit: true });
    cursor = idx + q.length;
  }
  if (cursor < str.length) parts.push({ t: str.slice(cursor), hit: false });
  const wrapQuotes = kind === 'value-string';
  return (
    <span {...(baseProps || {})}>
      {wrapQuotes ? '"' : ''}
      {parts.map((p, i) =>
        p.hit
          ? <mark key={i} className="response-search-highlight" data-search-hit="true">{p.t}</mark>
          : <span key={i}>{p.t}</span>
      )}
      {wrapQuotes ? '"' : ''}
    </span>
  );
}

function HexView({ body, showAll, onShowAll, testId }) {
  const { text, truncated, totalBytes } = useMemo(() => {
    const bytes = decodeToBytes(body);
    return buildHexDump(bytes, showAll ? Infinity : HEX_VIEW_BYTE_CAP);
  }, [body, showAll]);
  return (
    <div className="binary-hex-view-wrapper">
      <pre className="binary-hex-view" data-testid={testId}>{text}</pre>
      {truncated && (
        <div className="binary-hex-truncated">
          Showing first {HEX_VIEW_BYTE_CAP.toLocaleString()} bytes of {totalBytes.toLocaleString()}.{' '}
          <button className="link-button" onClick={onShowAll} data-testid={`${testId}-show-all`}>Show all</button>
        </div>
      )}
    </div>
  );
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
  const [imageViewMode, setImageViewMode] = useState('preview');
  const [pdfViewMode, setPdfViewMode] = useState('preview');
  const [hexShowAll, setHexShowAll] = useState(false);
  // 'all-expanded' (collapsed=false), 'all-collapsed' (collapsed=true)
  const [collapseMode, setCollapseMode] = useState('all-expanded');
  const [jsonViewKey, setJsonViewKey] = useState(0);
  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  // Last non-empty forceExpandSet — survives zero-match queries AND search close,
  // so that an in-progress typo or stopping mid-search doesn't collapse the tree
  // back to the pre-search state. Cleared only on explicit Collapse/Expand-all
  // or on a new response.
  const [persistentForceSet, setPersistentForceSet] = useState(null);
  const searchInputRef = useRef(null);
  const rootRef = useRef(null);
  const downloadingRef = useRef(false);
  const toast = useToast();

  // For examples, use example.response_data
  const displayResponse = isExample ? example?.response_data : response;

  // Reset htmlViewMode to 'preview' when displayResponse changes
  useEffect(() => {
    setHtmlViewMode('preview');
  }, [displayResponse]);

  // Reset binary view modes + hex expansion when a new response arrives
  useEffect(() => {
    setImageViewMode('preview');
    setPdfViewMode('preview');
    setHexShowAll(false);
    setCollapseMode('all-expanded');
    setJsonViewKey((k) => k + 1);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchActiveIndex(0);
    setPersistentForceSet(null);
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

  const isPdfBody = useMemo(
    () => !isExample && isPdfResponse(displayResponse?.headers),
    [isExample, displayResponse?.headers]
  );

  // Normalized query — strips boundary quotes so `"route_id"` matches key route_id.
  const effectiveSearchQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery]);

  // Match discovery (only when search is open and body is JSON non-example)
  const searchMatches = useMemo(() => {
    if (!searchOpen || !effectiveSearchQuery || !isJsonBody || isExample || jsonBody == null) return [];
    return findJsonMatches(jsonBody, effectiveSearchQuery);
  }, [searchOpen, effectiveSearchQuery, isJsonBody, isExample, jsonBody]);

  // Force-expand set — every prefix of every match path (for the CURRENT query).
  const forceExpandSet = useMemo(() => {
    if (!searchOpen || !effectiveSearchQuery || searchMatches.length === 0) return null;
    const s = new Set();
    for (const m of searchMatches) {
      for (let i = 0; i <= m.path.length; i++) {
        s.add(JSON.stringify(m.path.slice(0, i)));
      }
    }
    return s;
  }, [searchOpen, effectiveSearchQuery, searchMatches]);

  // Capture the latest non-empty forceExpandSet. This "sticky" set drives the
  // tree's expansion after the current query stops matching (typo, zero results)
  // and after the search bar closes — so we don't snap back to the pre-search
  // collapse state.
  useEffect(() => {
    if (forceExpandSet) setPersistentForceSet(forceExpandSet);
  }, [forceExpandSet]);

  // What actually drives the JsonView's expansion policy:
  //   - Active search with matches → forceExpandSet (current query's ancestors)
  //   - No current matches, but persistent set present → persistent set
  //   - Neither → null (fall back to collapseMode via `collapsed` prop)
  const activeExpandSet = forceExpandSet || persistentForceSet;

  // Re-mount JsonView when the expansion policy changes.
  // `activeExpandSet` identity changes when a new query produces new ancestors,
  // when the persistent set is cleared, or when it becomes available for the
  // first time. `collapseMode` matters only when activeExpandSet is null, but
  // depending on both keeps the logic uniform.
  const searchKeyBumpGuard = useRef(false);
  useEffect(() => {
    if (!searchKeyBumpGuard.current) {
      searchKeyBumpGuard.current = true;
      return;
    }
    setJsonViewKey((k) => k + 1);
  }, [activeExpandSet, collapseMode]);

  // Auto-close search when the body is no longer a JSON non-example view
  useEffect(() => {
    if (searchOpen && (!isJsonBody || isExample)) {
      setSearchOpen(false);
      setSearchQuery('');
      setSearchActiveIndex(0);
    }
  }, [isJsonBody, isExample, searchOpen]);

  // Active-match highlight + scroll into view
  useEffect(() => {
    if (!searchOpen || !rootRef.current) return;
    const hits = rootRef.current.querySelectorAll('[data-search-hit="true"]');
    hits.forEach((h) => h.classList.remove('response-search-highlight--active'));
    if (hits.length === 0) return;
    const safeIndex = Math.min(Math.max(searchActiveIndex, 0), hits.length - 1);
    const target = hits[safeIndex];
    if (target) {
      target.classList.add('response-search-highlight--active');
      try {
        // 'auto' (instant) — smooth scrolling feels sluggish when jumping
        // through many matches in a large response.
        target.scrollIntoView({ block: 'center', behavior: 'auto' });
      } catch {
        target.scrollIntoView();
      }
    }
  }, [searchOpen, effectiveSearchQuery, searchActiveIndex, jsonViewKey, searchMatches.length]);

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

  const handleExpandAll = () => {
    // Explicit user action → drop any sticky search expansion so the mode alone drives the tree.
    setPersistentForceSet(null);
    setCollapseMode('all-expanded');
    // Key bump is handled by the `[activeExpandSet, collapseMode]` effect.
  };

  const handleCollapseAll = () => {
    setPersistentForceSet(null);
    setCollapseMode('all-collapsed');
  };

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select?.();
    });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchActiveIndex(0);
  };

  const gotoNext = () => {
    if (searchMatches.length === 0) return;
    setSearchActiveIndex((i) => (i + 1) % searchMatches.length);
  };

  const gotoPrev = () => {
    if (searchMatches.length === 0) return;
    setSearchActiveIndex((i) => (i - 1 + searchMatches.length) % searchMatches.length);
  };

  const handleDownload = async () => {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    try {
      const result = await downloadResponse({
        body: displayResponse?.body,
        headers: displayResponse?.headers,
        url: displayResponse?.resolvedUrl || requestUrl,
      });
      if (result.ok) {
        toast.success(`Downloaded ${result.filename}`);
      } else if (!result.cancelled) {
        toast.error(result.error || 'Failed to download response');
      }
    } finally {
      downloadingRef.current = false;
    }
  };

  const handleRootKeyDown = (e) => {
    const isFind = (e.ctrlKey || e.metaKey) && typeof e.key === 'string' && e.key.toLowerCase() === 'f';
    if (isFind && isJsonBody && !isExample) {
      e.preventDefault();
      if (!searchOpen) {
        openSearch();
      } else {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select?.();
        });
      }
      return;
    }
    if (e.key === 'Escape' && searchOpen) {
      e.preventDefault();
      closeSearch();
    }
  };

  return (
    <div
      ref={rootRef}
      className="response-viewer"
      tabIndex={-1}
      onKeyDown={handleRootKeyDown}
    >
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
          {!isExample && displayResponse?.body && (
            <button
              className="response-download-btn"
              onClick={handleDownload}
              title="Download response"
              data-testid="response-download-btn"
            >
              <Download size={12} />
            </button>
          )}
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
            <>
              <BinaryViewToggle value={imageViewMode} onChange={setImageViewMode} testIdPrefix="image" />
              {imageViewMode === 'preview' && (
                <div className="image-preview-container" data-testid="image-preview-container">
                  <img
                    className="image-preview"
                    src={buildBinaryDataUrl(displayResponse?.body, imageMimeType)}
                    alt="Response image"
                    data-testid="image-preview"
                    onError={(e) => { e.currentTarget.dataset.failed = 'true'; }}
                  />
                </div>
              )}
              {imageViewMode === 'raw' && (
                <pre className="binary-raw-view" data-testid="image-raw-body">{displayResponse?.body}</pre>
              )}
              {imageViewMode === 'hex' && (
                <HexView
                  body={displayResponse?.body}
                  showAll={hexShowAll}
                  onShowAll={() => setHexShowAll(true)}
                  testId="image-hex-body"
                />
              )}
            </>
          ) : isPdfBody ? (
            <>
              <BinaryViewToggle value={pdfViewMode} onChange={setPdfViewMode} testIdPrefix="pdf" />
              {pdfViewMode === 'preview' && (
                <div className="pdf-preview-container" data-testid="pdf-preview-container">
                  <object
                    className="pdf-preview-frame"
                    data={buildBinaryDataUrl(displayResponse?.body, 'application/pdf')}
                    type="application/pdf"
                    data-testid="pdf-preview-frame"
                  >
                    <div className="pdf-preview-fallback" data-testid="pdf-preview-fallback">
                      <p>Your browser cannot display this PDF inline. Use the Download button above to save it.</p>
                    </div>
                  </object>
                </div>
              )}
              {pdfViewMode === 'raw' && (
                <pre className="binary-raw-view" data-testid="pdf-raw-body">{displayResponse?.body}</pre>
              )}
              {pdfViewMode === 'hex' && (
                <HexView
                  body={displayResponse?.body}
                  showAll={hexShowAll}
                  onShowAll={() => setHexShowAll(true)}
                  testId="pdf-hex-body"
                />
              )}
            </>
          ) : isJsonBody ? (
            <div className="response-json-container">
              <div className="response-json-dock" data-testid="response-json-dock">
                {searchOpen ? (
                  <>
                    <Search size={12} className="response-json-dock-search-icon" aria-hidden="true" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="response-json-dock-input"
                      placeholder="Search…"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSearchActiveIndex(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (e.shiftKey) gotoPrev();
                          else gotoNext();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          closeSearch();
                        }
                      }}
                      data-testid="response-search-input"
                      aria-label="Search response JSON"
                    />
                    <span className="response-json-dock-count" data-testid="response-search-count">
                      {searchMatches.length === 0
                        ? (effectiveSearchQuery ? '0 / 0' : '')
                        : `${Math.min(searchActiveIndex, searchMatches.length - 1) + 1} / ${searchMatches.length}${searchMatches.length >= SEARCH_MATCH_CAP ? '+' : ''}`}
                    </span>
                    <button
                      className="response-json-dock-btn"
                      onClick={gotoPrev}
                      disabled={searchMatches.length === 0}
                      title="Previous match (Shift+Enter)"
                      data-testid="response-search-prev"
                      aria-label="Previous match"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      className="response-json-dock-btn"
                      onClick={gotoNext}
                      disabled={searchMatches.length === 0}
                      title="Next match (Enter)"
                      data-testid="response-search-next"
                      aria-label="Next match"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      className="response-json-dock-btn"
                      onClick={closeSearch}
                      title="Close (Esc)"
                      data-testid="response-search-close"
                      aria-label="Close search"
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="response-json-dock-btn"
                      onClick={openSearch}
                      title="Search (Ctrl+F)"
                      data-testid="response-search-btn"
                      aria-label="Search response"
                    >
                      <Search size={12} />
                    </button>
                    <button
                      className="response-json-dock-btn"
                      onClick={handleExpandAll}
                      title="Expand all"
                      data-testid="response-expand-all-btn"
                      aria-label="Expand all"
                    >
                      <ChevronsUpDown size={12} />
                    </button>
                    <button
                      className="response-json-dock-btn"
                      onClick={handleCollapseAll}
                      title="Collapse all"
                      data-testid="response-collapse-all-btn"
                      aria-label="Collapse all"
                    >
                      <ChevronsDownUp size={12} />
                    </button>
                  </>
                )}
              </div>

              <div className="json-view-wrapper">
                <JsonView
                  key={jsonViewKey}
                  value={jsonBody}
                  displayDataTypes={false}
                  {...(activeExpandSet
                    ? {
                        shouldExpandNodeInitially: (isExpanded, { keys }) =>
                          activeExpandSet.has(JSON.stringify(keys)) || isExpanded,
                        // Only disable string truncation while actively searching — once the user
                        // has stopped typing the sticky set stays but long strings truncate again.
                        ...(forceExpandSet ? { shortenTextAfterLength: 0 } : {}),
                      }
                    : {
                        collapsed: collapseMode === 'all-collapsed' ? true : false,
                      })}
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
                >
                  {/* Library bug in @uiw/react-json-view@2.0.0-alpha.41: TypeNull/TypeUndefined/TypeNan
                      render nothing when displayDataTypes={false} because they lack a `child` fallback
                      (unlike TypeInt/TypeString). Supply one here — and also highlight search hits. */}
                  <JsonView.Null
                    render={(props, { type }) => {
                      if (type !== 'value') return null;
                      const highlighted = effectiveSearchQuery
                        ? renderHighlightedText({ baseProps: props, text: 'null', query: effectiveSearchQuery, kind: 'value' })
                        : null;
                      return highlighted || <span {...props}>null</span>;
                    }}
                  />
                  <JsonView.Undefined
                    render={(props, { type }) => {
                      if (type !== 'value') return null;
                      const highlighted = effectiveSearchQuery
                        ? renderHighlightedText({ baseProps: props, text: 'undefined', query: effectiveSearchQuery, kind: 'value' })
                        : null;
                      return highlighted || <span {...props}>undefined</span>;
                    }}
                  />
                  <JsonView.Nan
                    render={(props, { type }) => {
                      if (type !== 'value') return null;
                      const highlighted = effectiveSearchQuery
                        ? renderHighlightedText({ baseProps: props, text: 'NaN', query: effectiveSearchQuery, kind: 'value' })
                        : null;
                      return highlighted || <span {...props}>NaN</span>;
                    }}
                  />
                  <JsonView.String
                    render={(props, { type, value }) => {
                      if (type !== 'value') return null;
                      if (!effectiveSearchQuery || typeof value !== 'string') return null;
                      return renderHighlightedText({ baseProps: props, text: value, query: effectiveSearchQuery, kind: 'value-string' });
                    }}
                  />
                  <JsonView.KeyName
                    render={(props, { keyName }) => {
                      // Library passes the actual key name as `keyName` in the 2nd arg;
                      // `value` in the 2nd arg is the value AT this key, not the key itself.
                      if (!effectiveSearchQuery) return null;
                      const s = typeof keyName === 'string' ? keyName : String(keyName ?? '');
                      return renderHighlightedText({ baseProps: props, text: s, query: effectiveSearchQuery, kind: 'key' });
                    }}
                  />
                  <JsonView.True
                    render={(props, { type, value }) => {
                      if (type !== 'value') return null;
                      if (!effectiveSearchQuery) return null;
                      const s = value === undefined ? 'true' : String(value);
                      return renderHighlightedText({ baseProps: props, text: s, query: effectiveSearchQuery, kind: 'value' });
                    }}
                  />
                  <JsonView.False
                    render={(props, { type, value }) => {
                      if (type !== 'value') return null;
                      if (!effectiveSearchQuery) return null;
                      const s = value === undefined ? 'false' : String(value);
                      return renderHighlightedText({ baseProps: props, text: s, query: effectiveSearchQuery, kind: 'value' });
                    }}
                  />
                  <JsonView.Int
                    render={(props, { type, value }) => {
                      if (type !== 'value') return null;
                      if (!effectiveSearchQuery || value == null) return null;
                      return renderHighlightedText({ baseProps: props, text: String(value), query: effectiveSearchQuery, kind: 'value' });
                    }}
                  />
                  <JsonView.Float
                    render={(props, { type, value }) => {
                      if (type !== 'value') return null;
                      if (!effectiveSearchQuery || value == null) return null;
                      return renderHighlightedText({ baseProps: props, text: String(value), query: effectiveSearchQuery, kind: 'value' });
                    }}
                  />
                </JsonView>
              </div>
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
