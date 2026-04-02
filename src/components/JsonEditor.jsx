import { useCallback, useMemo, useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { lintGutter } from '@codemirror/lint';
import JSON5 from 'json5';
import { createEnvVariableExtensions } from '../utils/envVariableExtension';
import { createJsonLinter } from '../utils/jsonLinter';
import { extractComments, reinsertComments } from '../utils/jsonComments';
import { baseTheme, lightSyntaxHighlight, lightSelection, darkSyntaxHighlight, darkSelection } from '../utils/jsonEditorTheme';
import { useVariablePopover } from './VariablePopover';

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
      const { stripped, comments } = extractComments(value);
      const placeholders = [];
      const safe = stripped.replace(/"?\{\{([^}]+)\}\}"?/g, (match, varName) => {
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
      onChange?.(reinsertComments(formatted, comments));
    } catch (e) {
      console.warn('Cannot beautify invalid JSON:', e.message);
    }
  }, [value, onChange]);

  const handleMinify = useCallback(() => {
    if (!value) return;
    try {
      const { stripped } = extractComments(value);
      const placeholders = [];
      const safe = stripped.replace(/"?\{\{([^}]+)\}\}"?/g, (match, varName) => {
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
