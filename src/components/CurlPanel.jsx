import { useMemo } from 'react';
import { Copy, X } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { EditorView } from '@codemirror/view';
import { generateCurl } from './RequestEditor';
import { useWorkbench } from '../contexts/WorkbenchContext';
import { useToast } from './Toast';

const curlEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    height: '100%',
  },
  '.cm-content': {
    padding: '14px 4px',
    caretColor: 'transparent',
  },
  '.cm-cursor': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '28px',
    fontSize: '11px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(59, 130, 246, 0.2) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(59, 130, 246, 0.3) !important' },
});

const curlLightSyntax = EditorView.theme({
  '.ͼd': { color: '#16a34a' },
  '.ͼc': { color: '#d97706' },
  '.ͼb': { color: '#0284c7' },
  '.ͼe': { color: '#7c3aed' },
});

const curlDarkSyntax = EditorView.theme({
  '.ͼd': { color: '#4ade80' },
  '.ͼc': { color: '#fbbf24' },
  '.ͼb': { color: '#38bdf8' },
  '.ͼe': { color: '#a78bfa' },
});

const shellLang = StreamLanguage.define(shell);

// Walk up the collection hierarchy to resolve inherited auth (mirrors useResponseExecution.js)
function resolveInheritedAuth(collectionId, collections) {
  let currentId = collectionId;
  let iterations = 0;
  while (currentId && iterations < 50) {
    const col = collections.find(c => c.id === currentId);
    if (!col) break;
    if (col.auth_type && col.auth_type !== 'none' && col.auth_type !== 'inherit') {
      return { auth_type: col.auth_type, auth_token: col.auth_token || '' };
    }
    currentId = col.parent_id;
    iterations++;
  }
  return { auth_type: 'none', auth_token: '' };
}

export function CurlPanel({ width, theme, onResize, onClose }) {
  const toast = useToast();
  const { activeTab, selectedRequest, selectedExample, activeEnvironment, collections, collectionVariables } = useWorkbench();

  const curlPreview = useMemo(() => {
    const req = activeTab?.type === 'example'
      ? selectedExample?.request_data
      : selectedRequest;
    if (!req) return '';

    // Resolve inherited auth — for examples, look up the parent request's collection_id
    let authType = req.auth_type || 'none';
    let authToken = req.auth_token || '';
    if (authType === 'inherit' && collections && collections.length > 0) {
      let collectionIdForAuth = req.collection_id;
      if (!collectionIdForAuth && activeTab?.type === 'example' && selectedExample?.request_id) {
        for (const c of collections) {
          const found = c.requests?.find(r => r.id === selectedExample.request_id);
          if (found) { collectionIdForAuth = found.collection_id; break; }
        }
      }
      if (collectionIdForAuth) {
        const resolved = resolveInheritedAuth(collectionIdForAuth, collections);
        authType = resolved.auth_type;
        authToken = resolved.auth_token;
      }
    }

    const sub = (text) => {
      if (!text) return text;
      // Build merged map: collection (lower priority) then env (higher priority overrides).
      // Single substitution pass so env truly overrides — otherwise replacing collection first
      // erases the {{key}} pattern before env ever sees it.
      const resolved = new Map();
      if (collectionVariables && collectionVariables.length > 0) {
        for (const v of collectionVariables) {
          if (v.enabled === false || !v.key) continue;
          resolved.set(v.key, v.value || v.current_value || v.initial_value || '');
        }
      }
      if (activeEnvironment?.variables) {
        for (const v of activeEnvironment.variables) {
          if (v.enabled === false || !v.key) continue;
          resolved.set(v.key, v.value || v.current_value || v.initial_value || '');
        }
      }
      let result = text;
      for (const [key, value] of resolved) {
        result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
      }
      return result;
    };

    const headers = (req.headers || []).map(h => ({ ...h, key: sub(h.key), value: sub(h.value) }));
    const fd = (req.form_data || []).map(f => ({ ...f, key: sub(f.key), value: f.type === 'file' ? f.value : sub(f.value) }));
    return generateCurl(
      req.method || 'GET',
      sub(req.url || ''),
      headers,
      sub(req.body || ''),
      req.body_type || 'none',
      fd,
      authType,
      sub(authToken)
    );
  }, [selectedRequest, selectedExample, activeTab?.type, activeEnvironment, collections, collectionVariables]);

  return (
    <>
      <div className="curl-resize-handle" onMouseDown={onResize} />
      <aside className="curl-panel" style={{ width }}>
        <div className="curl-panel-header">
          <span className="curl-panel-title">cURL</span>
          <div className="curl-panel-actions">
            <button
              className="btn-icon small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(curlPreview);
                  toast.success('cURL copied to clipboard');
                } catch {
                  const textArea = document.createElement('textarea');
                  textArea.value = curlPreview;
                  textArea.style.position = 'fixed';
                  textArea.style.left = '-9999px';
                  document.body.appendChild(textArea);
                  textArea.select();
                  document.execCommand('copy');
                  document.body.removeChild(textArea);
                  toast.success('cURL copied to clipboard');
                }
              }}
              title="Copy to clipboard"
            >
              <Copy size={14} />
            </button>
            <button className="btn-icon small" onClick={onClose} title="Close panel">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="curl-panel-code" data-testid="curl-panel-code">
          <CodeMirror
            value={curlPreview}
            readOnly
            editable={false}
            theme={theme === 'dark' ? 'dark' : 'light'}
            extensions={[
              shellLang,
              curlEditorTheme,
              theme === 'dark' ? curlDarkSyntax : curlLightSyntax,
              EditorView.lineWrapping,
            ]}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: false,
              highlightActiveLine: false,
              foldGutter: false,
              bracketMatching: false,
              closeBrackets: false,
              autocompletion: false,
              indentOnInput: false,
              searchKeymap: false,
            }}
          />
        </div>
      </aside>
    </>
  );
}
