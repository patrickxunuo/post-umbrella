import { useCallback, useMemo, useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import JSON5 from 'json5';
import jsonlint from 'jsonlint-mod';
import { createEnvVariableExtensions } from '../utils/envVariableExtension';
import { useVariablePopover } from './VariablePopover';

function createJsonLinter() {
  return linter((view) => {
    const doc = view.state.doc;
    const text = doc.toString();
    if (!text.trim()) return [];

    const envVarRegex = /"?\{\{([^}]+)\}\}"?/g;
    const envVarRanges = [];
    const safeText = text.replace(envVarRegex, (match, _varName, offset) => {
      envVarRanges.push({ from: offset, to: offset + match.length });
      const len = match.length;
      if (len < 2) return match;
      return '"' + 'a'.repeat(len - 2) + '"';
    });

    try {
      jsonlint.parse(safeText);
      return [];
    } catch (e) {
      const errMsg = e.message || '';
      const lines = errMsg.split('\n');

      // Extract line number: "Parse error on line N:"
      const lineMatch = errMsg.match(/line (\d+)/);
      // Extract "Expecting ..., got ..." message
      const expectingLine = lines.find(l => /^Expecting\s/.test(l));
      // Extract column from caret pointer line
      const ptrLine = lines.find(l => l.includes('^'));
      const errorCol = ptrLine ? ptrLine.indexOf('^') : 0;

      let message = expectingLine
        ? expectingLine.replace(/'EOF',?\s*/g, '').trim()
        : errMsg.split('\n')[0];

      if (!lineMatch) return [];
      const errorLine = parseInt(lineMatch[1], 10);

      if (errorLine < 1 || errorLine > doc.lines) {
        const lastLine = doc.line(doc.lines);
        const trimmed = lastLine.text.trimEnd();
        const from = lastLine.from + Math.max(0, trimmed.length - 1);
        const to = lastLine.from + Math.max(trimmed.length, 1);
        return [{ from, to: Math.min(to, doc.length), severity: 'error', message }];
      }

      const line = doc.line(errorLine);
      const from = line.from + Math.min(errorCol, line.length);

      const overlapsEnvVar = envVarRanges.some(
        (range) => from >= range.from && from < range.to
      );
      if (overlapsEnvVar) return [];

      let to = line.from + line.text.trimEnd().length;
      if (to <= from) to = Math.min(from + 1, line.to);
      to = Math.min(to, doc.length);

      return [{ from, to, severity: 'error', message }];
    }
  }, { delay: 300 });
}

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
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'rgba(128, 128, 128, 0.08)',
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
    backgroundColor: 'rgba(128, 128, 128, 0.08)',
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
  // Lint error squiggly underline
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--accent-danger)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '2px',
  },
  // Lint tooltip
  '.cm-tooltip.cm-tooltip-lint': {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-primary)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-lg)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    padding: '0',
  },
  '.cm-diagnostic-error': {
    color: 'var(--accent-danger)',
    borderLeft: '3px solid var(--accent-danger)',
    padding: '6px 10px',
    margin: '0',
  },
  // Lint gutter
  '.cm-gutter-lint': {
    width: '14px',
  },
  '.cm-gutter-lint .cm-gutterElement': {
    padding: '0',
  },
});

// Light theme syntax colors
const lightSyntaxHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.string, color: '#16a34a' },
  { tag: tags.number, color: '#d97706' },
  { tag: tags.bool, color: '#7c3aed' },
  { tag: tags.null, color: '#dc2626' },
  { tag: tags.propertyName, color: '#0284c7' },
  { tag: tags.punctuation, color: '#64748b' },
  { tag: tags.brace, color: '#64748b' },
  { tag: tags.squareBracket, color: '#64748b' },
]));

const lightSelection = EditorView.theme({
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(37, 99, 235, 0.4) !important',
  },
  '.cm-line ::selection': {
    backgroundColor: 'rgba(37, 99, 235, 0.45) !important',
    color: '#1e293b !important',
  },
  '.cm-content': {
    caretColor: 'var(--accent-primary)',
  },
});

// Dark theme syntax colors
const darkSyntaxHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.string, color: '#4ade80' },
  { tag: tags.number, color: '#fbbf24' },
  { tag: tags.bool, color: '#a78bfa' },
  { tag: tags.null, color: '#f87171' },
  { tag: tags.propertyName, color: '#38bdf8' },
  { tag: tags.punctuation, color: '#94a3b8' },
  { tag: tags.brace, color: '#94a3b8' },
  { tag: tags.squareBracket, color: '#94a3b8' },
]));

const darkSelection = EditorView.theme({
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(96, 165, 250, 0.45) !important',
  },
  '.cm-line ::selection': {
    backgroundColor: 'rgba(96, 165, 250, 0.5) !important',
    color: '#f1f5f9 !important',
  },
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
  activeEnvironment,
  collectionVariables,
}) {
  const variablePopover = useVariablePopover();
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

  const extensions = useMemo(() => {
    const exts = [
      json(),
      baseTheme,
      isDark ? darkSyntaxHighlight : lightSyntaxHighlight,
      isDark ? darkSelection : lightSelection,
      EditorView.lineWrapping,
    ];
    if (!readOnly) {
      exts.push(createJsonLinter());
      exts.push(lintGutter());
    }
    if (activeEnvironment || collectionVariables) {
      exts.push(...createEnvVariableExtensions({
        activeEnvironment,
        collectionVariables,
        onHover: variablePopover?.show,
        onLeave: variablePopover?.hide,
      }));
    }
    return exts;
  }, [isDark, readOnly, activeEnvironment, collectionVariables, variablePopover]);

  const handleChange = useCallback((val) => {
    onChange?.(val);
  }, [onChange]);

  const handleBeautify = useCallback(() => {
    if (!value) return;
    try {
      // Replace {{var}} with placeholders before parsing, then restore after
      // Track whether each placeholder was originally quoted or bare
      const placeholders = [];
      const safe = value.replace(/"?\{\{([^}]+)\}\}"?/g, (match, varName) => {
        const idx = placeholders.length;
        const wasQuoted = match.startsWith('"') && match.endsWith('"');
        placeholders.push({ original: `{{${varName.trim()}}}`, wasQuoted });
        return `"__ENV_VAR_${idx}__"`;
      });
      const parsed = JSON5.parse(safe);
      let formatted = JSON.stringify(parsed, null, 2);
      placeholders.forEach(({ original, wasQuoted }, i) => {
        const replacement = wasQuoted ? `"${original}"` : original;
        formatted = formatted.replace(`"__ENV_VAR_${i}__"`, replacement);
      });
      onChange?.(formatted);
    } catch (e) {
      console.warn('Cannot beautify invalid JSON:', e.message);
    }
  }, [value, onChange]);

  const handleMinify = useCallback(() => {
    if (!value) return;
    try {
      const placeholders = [];
      const safe = value.replace(/"?\{\{([^}]+)\}\}"?/g, (match, varName) => {
        const idx = placeholders.length;
        const wasQuoted = match.startsWith('"') && match.endsWith('"');
        placeholders.push({ original: `{{${varName.trim()}}}`, wasQuoted });
        return `"__ENV_VAR_${idx}__"`;
      });
      const parsed = JSON5.parse(safe);
      let minified = JSON.stringify(parsed);
      placeholders.forEach(({ original, wasQuoted }, i) => {
        const replacement = wasQuoted ? `"${original}"` : original;
        minified = minified.replace(`"__ENV_VAR_${i}__"`, replacement);
      });
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
      const safe = value.replace(/"?\{\{([^}]+)\}\}"?/g, '"__env_check__"');
      JSON5.parse(safe);
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
          defaultHighlightStyle: false,
        }}
        className="json-codemirror"
      />
    </div>
  );
}
