import { useCallback, useMemo, useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import JSON5 from 'json5';

// Custom theme that matches the app's design system using CSS variables
const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-content': {
    caretColor: 'var(--accent-primary)',
    padding: '12px 4px',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent-primary)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(59, 130, 246, 0.3) !important',
  },
  '.cm-line ::selection': {
    backgroundColor: 'rgba(59, 130, 246, 0.3) !important',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-input)',
    color: 'var(--text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-activeLineGutter': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '32px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-tertiary)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--accent-primary-subtle)',
    outline: '1px solid var(--accent-primary)',
  },
  // Placeholder styling
  '.cm-placeholder': {
    color: 'var(--text-tertiary)',
    fontStyle: 'italic',
  },
});

// Light theme syntax colors
const lightSyntax = EditorView.theme({
  '.ͼd': { color: '#16a34a' },           // strings - green
  '.ͼc': { color: '#d97706' },           // numbers - amber
  '.ͼe': { color: '#7c3aed' },           // booleans - purple
  '.ͼb': { color: '#dc2626' },           // null - red
  '.ͼm': { color: '#0284c7' },           // property names - sky blue
  '.ͼ7': { color: '#64748b' },           // punctuation - slate
});

// Dark theme syntax colors (brighter for better visibility)
const darkSyntax = EditorView.theme({
  '.ͼd': { color: '#4ade80' },           // strings - green
  '.ͼc': { color: '#fbbf24' },           // numbers - amber
  '.ͼe': { color: '#a78bfa' },           // booleans - purple
  '.ͼb': { color: '#f87171' },           // null - red
  '.ͼm': { color: '#38bdf8' },           // property names - sky blue
  '.ͼ7': { color: '#94a3b8' },           // punctuation - slate
});

export function JsonEditor({
  value,
  onChange,
  placeholder = 'Enter JSON...',
  readOnly = false,
  showBeautify = true,
  minHeight = '150px',
  maxHeight,
  className = '',
}) {
  // Detect and react to theme changes
  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    }
    return false;
  });

  // Listen for theme changes
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  const extensions = useMemo(() => [
    json(),
    baseTheme,
    isDark ? darkSyntax : lightSyntax,
    EditorView.lineWrapping,
  ], [isDark]);

  const handleChange = useCallback((val) => {
    onChange?.(val);
  }, [onChange]);

  const handleBeautify = useCallback(() => {
    if (!value) return;
    try {
      // Parse with JSON5 to support comments, then output standard JSON
      const parsed = JSON5.parse(value);
      const formatted = JSON.stringify(parsed, null, 2);
      onChange?.(formatted);
    } catch (e) {
      // Invalid JSON - can't beautify
      console.warn('Cannot beautify invalid JSON:', e.message);
    }
  }, [value, onChange]);

  const handleMinify = useCallback(() => {
    if (!value) return;
    try {
      // Parse with JSON5 to support comments, then output standard JSON
      const parsed = JSON5.parse(value);
      const minified = JSON.stringify(parsed);
      onChange?.(minified);
    } catch (e) {
      console.warn('Cannot minify invalid JSON:', e.message);
    }
  }, [value, onChange]);

  // Check if JSON is valid for showing beautify button state
  // Uses JSON5 to allow comments and trailing commas
  const isValidJson = useMemo(() => {
    if (!value) return true;
    try {
      JSON5.parse(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  return (
    <div className={`json-editor-wrapper ${className}`}>
      {showBeautify && !readOnly && (
        <div className="json-editor-toolbar">
          <button
            type="button"
            className="btn-json-action"
            onClick={handleBeautify}
            disabled={!value || !isValidJson}
            title={!isValidJson ? 'Fix JSON syntax errors first' : 'Format JSON'}
          >
            Beautify
          </button>
          <button
            type="button"
            className="btn-json-action"
            onClick={handleMinify}
            disabled={!value || !isValidJson}
            title={!isValidJson ? 'Fix JSON syntax errors first' : 'Minify JSON'}
          >
            Minify
          </button>
          {!isValidJson && value && (
            <span className="json-error-indicator">Invalid syntax</span>
          )}
        </div>
      )}
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        readOnly={readOnly}
        theme={isDark ? 'dark' : 'light'}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          indentOnInput: true,
        }}
        className="json-codemirror"
      />
    </div>
  );
}
