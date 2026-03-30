import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronRight, Copy, Check, RefreshCw, Search } from 'lucide-react';
import * as data from '../data/index.js';
import { METHOD_COLORS } from '../constants/methodColors';

function MethodBadge({ method }) {
  return (
    <span className="docs-method" style={{ color: METHOD_COLORS[method] || '#888' }}>
      {method}
    </span>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className="docs-copy-btn" onClick={handleCopy} title="Copy">
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function JsonBlock({ value, label }) {
  if (!value) return null;
  let formatted = value;
  if (typeof value === 'string') {
    try { formatted = JSON.stringify(JSON.parse(value), null, 2); } catch { formatted = value; }
  } else if (typeof value === 'object') {
    formatted = JSON.stringify(value, null, 2);
  }
  return (
    <div className="docs-code-block">
      {label && <div className="docs-code-label">{label}</div>}
      <div className="docs-code-content">
        <pre>{formatted}</pre>
        <CopyButton text={formatted} />
      </div>
    </div>
  );
}

function ParamsTable({ items, title }) {
  const filtered = items?.filter(p => p.key && p.enabled !== false);
  if (!filtered?.length) return null;
  return (
    <div className="docs-section">
      <h4 className="docs-section-title">{title}</h4>
      <table className="docs-table">
        <thead><tr><th>Key</th><th>Value</th></tr></thead>
        <tbody>
          {filtered.map((p, i) => (
            <tr key={i}>
              <td><code>{p.key}</code></td>
              <td>{p.value || <span className="docs-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestDoc({ request, examples }) {
  const [expanded, setExpanded] = useState(false);
  const hasBody = request.body_type && request.body_type !== 'none' && request.body;
  const hasHeaders = request.headers?.some(h => h.key && h.enabled !== false);
  const hasParams = request.params?.some(p => p.key && p.enabled !== false);
  const hasAuth = request.auth_type && request.auth_type !== 'none';
  const hasFormData = request.body_type === 'form-data' && request.form_data?.some(f => f.key);

  return (
    <div className="docs-request" id={`req-${request.id}`}>
      <div className="docs-request-header" onClick={() => setExpanded(!expanded)}>
        <ChevronRight size={14} className={`docs-chevron ${expanded ? 'open' : ''}`} />
        <MethodBadge method={request.method || 'GET'} />
        <span className="docs-request-name">{request.name}</span>
        <span className="docs-request-url">{request.url}</span>
      </div>

      {expanded && (
        <div className="docs-request-body">
          <div className="docs-url-bar">
            <MethodBadge method={request.method || 'GET'} />
            <code className="docs-url-full">{request.url}</code>
            <CopyButton text={request.url} />
          </div>

          {hasAuth && (
            <div className="docs-section">
              <h4 className="docs-section-title">Authorization</h4>
              <p className="docs-auth-type">
                {request.auth_type === 'bearer' && 'Bearer Token'}
                {request.auth_type === 'inherit' && 'Inherited from parent'}
              </p>
            </div>
          )}

          <ParamsTable items={request.params} title="Query Parameters" />
          <ParamsTable items={request.headers} title="Headers" />

          {hasFormData && (
            <div className="docs-section">
              <h4 className="docs-section-title">Form Data</h4>
              <table className="docs-table">
                <thead><tr><th>Key</th><th>Type</th><th>Value</th></tr></thead>
                <tbody>
                  {request.form_data.filter(f => f.key && f.enabled !== false).map((f, i) => (
                    <tr key={i}>
                      <td><code>{f.key}</code></td>
                      <td>{f.type || 'text'}</td>
                      <td>{f.type === 'file' ? (f.fileName || 'file') : (f.value || <span className="docs-muted">—</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasBody && request.body_type !== 'form-data' && (
            <JsonBlock value={request.body} label={`Body (${request.body_type})`} />
          )}

          {examples.length > 0 && (
            <div className="docs-section">
              <h4 className="docs-section-title">Examples ({examples.length})</h4>
              {examples.map(ex => (
                <ExampleDoc key={ex.id} example={ex} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExampleDoc({ example }) {
  const [showResponse, setShowResponse] = useState(false);
  const reqData = example.request_data || {};
  const resData = example.response_data;

  return (
    <div className="docs-example">
      <div className="docs-example-header" onClick={() => setShowResponse(!showResponse)}>
        <ChevronRight size={12} className={`docs-chevron ${showResponse ? 'open' : ''}`} />
        <span className="docs-example-name">{example.name}</span>
        {resData?.status && (
          <span className={`docs-status ${resData.status < 400 ? 'success' : 'error'}`}>
            {resData.status}
          </span>
        )}
      </div>
      {showResponse && (
        <div className="docs-example-body">
          {reqData.body && <JsonBlock value={reqData.body} label="Request Body" />}
          {resData?.body && <JsonBlock value={resData.body} label={`Response ${resData.status || ''}`} />}
        </div>
      )}
    </div>
  );
}

function FolderSection({ folder, requests, allExamples, allFolders, isRoot = false }) {
  // Collect requests for this folder and all descendants in order
  const sections = [];

  const collectSections = (folderId, folderName, isTop) => {
    const folderRequests = requests.filter(r => r.collection_id === folderId);
    if (folderRequests.length > 0) {
      sections.push({ type: 'folder', name: folderName, isRoot: isTop });
      folderRequests.forEach(req => sections.push({ type: 'request', req }));
    }
    const children = (allFolders || []).filter(f => f.parent_id === folderId);
    children.forEach(child => collectSections(child.id, child.name, false));
  };

  collectSections(folder.id, folder.name, isRoot);
  if (sections.length === 0) return null;

  return (
    <div className="docs-folder">
      {sections.map((item, i) => {
        if (item.type === 'folder' && !item.isRoot) {
          return <div key={`folder-${i}`} className="docs-folder-divider">{item.name}</div>;
        }
        if (item.type === 'request') {
          return (
            <RequestDoc
              key={item.req.id}
              request={item.req}
              examples={allExamples[item.req.id] || []}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

export function CollectionDocs({ collectionId, collectionName, cachedData, onCacheUpdate }) {
  const [tree, setTree] = useState(cachedData?.tree || null);
  const [allExamples, setAllExamples] = useState(cachedData?.examples || {});
  const [loading, setLoading] = useState(!cachedData);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchDocs = useCallback(async () => {
    if (!collectionId) return;
    setLoading(true);
    try {
      const collections = await data.getCollectionTree(collectionId);
      setTree(collections);

      const exampleMap = {};
      const allReqs = collections.flatMap(c => c.requests || []);
      await Promise.all(allReqs.map(async (req) => {
        try {
          const examples = await data.getExamples(req.id);
          exampleMap[req.id] = examples;
        } catch {}
      }));
      setAllExamples(exampleMap);
      onCacheUpdate?.({ tree: collections, examples: exampleMap });
    } catch (err) {
      console.error('Failed to load docs:', err);
    } finally {
      setLoading(false);
    }
  }, [collectionId, onCacheUpdate]);

  useEffect(() => {
    if (!cachedData) fetchDocs();
  }, [collectionId, refreshKey]);

  const handleRefresh = useCallback(() => {
    onCacheUpdate?.(null);
    setTree(null);
    setAllExamples({});
    setRefreshKey(k => k + 1);
  }, [onCacheUpdate]);

  const rootCollection = tree?.find(c => c.id === collectionId);
  const childFolders = tree?.filter(c => c.parent_id === collectionId) || [];
  const allRequests = tree?.flatMap(c => c.requests || []) || [];

  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return allRequests;
    const q = searchQuery.toLowerCase();
    return allRequests.filter(r =>
      r.name?.toLowerCase().includes(q) ||
      r.url?.toLowerCase().includes(q) ||
      r.method?.toLowerCase().includes(q)
    );
  }, [allRequests, searchQuery]);

  if (loading) {
    return (
      <div className="docs-loading">
        <div className="loading-spinner medium" />
        <span>Generating documentation...</span>
      </div>
    );
  }

  if (!tree || allRequests.length === 0) {
    return (
      <div className="docs-empty">
        <p>No requests in this collection to document.</p>
      </div>
    );
  }

  return (
    <div className="docs-container">
      <div className="docs-content">
        <div className="docs-header">
          <h1>{collectionName || rootCollection?.name}</h1>
          <span className="docs-count">{allRequests.length} endpoints</span>
          <button className="docs-refresh-btn" onClick={handleRefresh} title="Refresh documentation">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="docs-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search endpoints..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {searchQuery.trim() ? (
          filteredRequests.length === 0 ? (
            <div className="docs-no-results">No endpoints matching "{searchQuery}"</div>
          ) : (
            filteredRequests.map(req => (
              <RequestDoc
                key={req.id}
                request={req}
                examples={allExamples[req.id] || []}
              />
            ))
          )
        ) : (
          <FolderSection
            folder={rootCollection}
            requests={allRequests}
            allExamples={allExamples}
            allFolders={tree}
            isRoot
          />
        )}
      </div>
    </div>
  );
}
