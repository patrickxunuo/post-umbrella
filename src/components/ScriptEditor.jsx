import { useCallback, useMemo, useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';

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
  '.cm-placeholder': {
    color: 'var(--text-tertiary)',
    fontStyle: 'italic',
  },
});

// Light theme syntax colors
const lightSyntax = EditorView.theme({
  '.cm-keyword': { color: '#7c3aed' },        // keywords - purple
  '.cm-string': { color: '#16a34a' },          // strings - green
  '.cm-number': { color: '#d97706' },          // numbers - amber
  '.cm-bool': { color: '#7c3aed' },            // booleans - purple
  '.cm-null': { color: '#dc2626' },            // null - red
  '.cm-propertyName': { color: '#0284c7' },    // property names - sky blue
  '.cm-variableName': { color: '#1e40af' },    // variables - blue
  '.cm-comment': { color: '#64748b', fontStyle: 'italic' }, // comments - slate
  '.cm-operator': { color: '#64748b' },        // operators - slate
  '.cm-punctuation': { color: '#64748b' },     // punctuation - slate
});

// Dark theme syntax colors
const darkSyntax = EditorView.theme({
  '.cm-keyword': { color: '#a78bfa' },         // keywords - purple
  '.cm-string': { color: '#4ade80' },          // strings - green
  '.cm-number': { color: '#fbbf24' },          // numbers - amber
  '.cm-bool': { color: '#a78bfa' },            // booleans - purple
  '.cm-null': { color: '#f87171' },            // null - red
  '.cm-propertyName': { color: '#38bdf8' },    // property names - sky blue
  '.cm-variableName': { color: '#60a5fa' },    // variables - blue
  '.cm-comment': { color: '#94a3b8', fontStyle: 'italic' }, // comments - slate
  '.cm-operator': { color: '#94a3b8' },        // operators - slate
  '.cm-punctuation': { color: '#94a3b8' },     // punctuation - slate
});

export function ScriptEditor({
  value,
  onChange,
  placeholder = '// Write your script here...',
  readOnly = false,
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
    javascript(),
    baseTheme,
    isDark ? darkSyntax : lightSyntax,
    EditorView.lineWrapping,
  ], [isDark]);

  const handleChange = useCallback((val) => {
    onChange?.(val);
  }, [onChange]);

  return (
    <div className={`script-editor-wrapper ${className}`}>
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
        className="script-codemirror"
      />
    </div>
  );
}
