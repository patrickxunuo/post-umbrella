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

export function CurlPanel({ width, theme, onResize, onClose }) {
  const toast = useToast();
  const { activeTab, selectedRequest, selectedExample, activeEnvironment } = useWorkbench();

  const curlPreview = useMemo(() => {
    const req = activeTab?.type === 'example'
      ? selectedExample?.request_data
      : selectedRequest;
    if (!req) return '';
    const sub = (text) => {
      if (!text || !activeEnvironment) return text;
      let result = text;
      for (const v of activeEnvironment.variables) {
        if (v.enabled && v.key) {
          result = result.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, 'g'), v.value || '');
        }
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
      req.auth_type || 'none',
      sub(req.auth_token || '')
    );
  }, [selectedRequest, selectedExample, activeTab?.type, activeEnvironment]);

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
        <div className="curl-panel-code">
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
