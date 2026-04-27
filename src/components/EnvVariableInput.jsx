import { useState, useRef, useEffect, useCallback } from 'react';
import * as data from '../data/index.js';
import { useVariablePopover } from './VariablePopover';
import { extractPathVarTokens } from '../utils/substituteVariables';

// Component that wraps an input and adds hover-to-edit for environment variables
export function EnvVariableInput({
  value,
  onChange,
  onKeyDown,
  onPaste,
  placeholder,
  className,
  activeEnvironment,
  collectionVariables,
  rootCollectionId,
  onEnvironmentUpdate,
  pathVariables,
  onPathVariableValueChange,
  disabled = false,
  ...rest
}) {
  const variablePopover = useVariablePopover();
  // Autocomplete state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [autocompleteInfo, setAutocompleteInfo] = useState(null); // { start, filterText }
  const [suggestionsPos, setSuggestionsPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Find the variable at a given position in the text (env or path)
  const findVariableAtPosition = (text, pos) => {
    const envRegex = /\{\{([^}]+)\}\}/g;
    let match;
    while ((match = envRegex.exec(text)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;
      if (pos >= start && pos <= end) {
        return {
          kind: 'env',
          name: match[1].trim(),
          start,
          end,
          fullMatch: match[0],
        };
      }
    }
    if (pathVariables && pathVariables.length > 0) {
      const tokens = extractPathVarTokens(text);
      for (const t of tokens) {
        if (pos >= t.start && pos <= t.end) {
          return {
            kind: 'path',
            name: t.key,
            start: t.start,
            end: t.end,
            fullMatch: text.slice(t.start, t.end),
          };
        }
      }
    }
    return null;
  };

  // Get the current value of a variable from environment or collection
  const getVariableValue = (varName) => {
    const envVar = activeEnvironment?.variables?.find(v => v.key === varName && v.enabled);
    if (envVar) return envVar.value ?? null;
    const colVar = collectionVariables?.find(v => v.key === varName && v.enabled);
    if (colVar) return colVar.value ?? null;
    return null;
  };

  // Check if variable exists in environment
  const variableExists = (varName) => {
    if (activeEnvironment?.variables?.some(v => v.key === varName && v.enabled)) return true;
    if (collectionVariables?.some(v => v.key === varName && v.enabled)) return true;
    return false;
  };

  const getVariableSource = (varName) => {
    if (activeEnvironment?.variables?.some(v => v.key === varName && v.enabled)) return 'env';
    if (collectionVariables?.some(v => v.key === varName && v.enabled)) return 'collection';
    return null;
  };

  // Check if the value contains any variables (env or path)
  const hasVariables = /\{\{[^}]+\}\}/.test(value || '')
    || (pathVariables?.length > 0 && extractPathVarTokens(value || '').length > 0);

  // Get filtered variables for autocomplete (merged collection + env vars)
  const getFilteredVariables = useCallback((filterText) => {
    const filter = filterText.toLowerCase();
    const result = [];
    const seenKeys = new Set();

    // Add env variables first (higher priority)
    if (activeEnvironment?.variables) {
      for (const v of activeEnvironment.variables) {
        if (v.enabled && v.key.toLowerCase().includes(filter)) {
          result.push({ ...v, source: 'env' });
          seenKeys.add(v.key);
        }
      }
    }

    // Add collection variables (lower priority, skip duplicates)
    if (collectionVariables) {
      for (const v of collectionVariables) {
        if (v.enabled && v.key.toLowerCase().includes(filter) && !seenKeys.has(v.key)) {
          result.push({ ...v, source: 'collection' });
        }
      }
    }

    return result.sort((a, b) => a.key.localeCompare(b.key));
  }, [activeEnvironment, collectionVariables]);

  // Check if cursor is inside an incomplete {{ pattern (for autocomplete trigger)
  const checkAutocomplete = useCallback((text, cursorPos) => {
    // Look backwards from cursor to find {{
    const beforeCursor = text.slice(0, cursorPos);

    // Find the last {{ that doesn't have a matching }}
    const lastOpenIndex = beforeCursor.lastIndexOf('{{');
    if (lastOpenIndex === -1) return null;

    // Check if there's a }} after the {{ but before cursor
    const afterOpen = beforeCursor.slice(lastOpenIndex);
    if (afterOpen.includes('}}')) return null;

    // Extract the partial variable name (everything after {{ until cursor)
    const filterText = beforeCursor.slice(lastOpenIndex + 2);

    // Don't trigger if filter contains spaces or special chars (likely not a variable)
    if (/[^a-zA-Z0-9_-]/.test(filterText)) return null;

    return {
      start: lastOpenIndex,
      filterText,
    };
  }, []);

  // Insert a variable at the autocomplete position
  const insertVariable = useCallback((varKey) => {
    if (!autocompleteInfo || !inputRef.current) return;

    const { start } = autocompleteInfo;
    const before = value.slice(0, start);
    const afterCursor = value.slice(inputRef.current.selectionStart);

    // Find where the incomplete pattern ends (could have partial text after cursor too)
    let afterClean = afterCursor;
    // If there's a }} right after, include it in replacement
    if (afterClean.startsWith('}}')) {
      afterClean = afterClean.slice(2);
    }

    const newValue = `${before}{{${varKey}}}${afterClean}`;
    const newCursorPos = start + varKey.length + 4; // position after }}

    // Create synthetic event to trigger onChange
    const syntheticEvent = {
      target: { value: newValue }
    };
    onChange(syntheticEvent);

    // Set cursor position after React re-renders
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        inputRef.current.focus();
      }
    }, 0);

    setShowSuggestions(false);
    setAutocompleteInfo(null);
    setSuggestionIndex(0);
  }, [autocompleteInfo, value, onChange]);

  // Handle input change with autocomplete detection
  const handleInputChange = useCallback((e) => {
    onChange(e);

    // Check for autocomplete trigger after state updates
    setTimeout(() => {
      if (!inputRef.current || !activeEnvironment) {
        setShowSuggestions(false);
        return;
      }

      const cursorPos = inputRef.current.selectionStart;
      const info = checkAutocomplete(e.target.value, cursorPos);

      if (info) {
        const filtered = getFilteredVariables(info.filterText);
        if (filtered.length > 0) {
          setAutocompleteInfo(info);
          setShowSuggestions(true);
          setSuggestionIndex(0);
          // Calculate position for fixed positioning
          if (inputRef.current) {
            const rect = inputRef.current.getBoundingClientRect();
            setSuggestionsPos({
              top: rect.bottom + 4,
              left: rect.left,
              width: rect.width,
            });
          }
        } else {
          setShowSuggestions(false);
        }
      } else {
        setShowSuggestions(false);
        setAutocompleteInfo(null);
      }
    }, 0);
  }, [onChange, activeEnvironment, checkAutocomplete, getFilteredVariables]);

  // Handle keyboard navigation for autocomplete
  const handleInputKeyDown = useCallback((e) => {
    if (showSuggestions && autocompleteInfo) {
      const filtered = getFilteredVariables(autocompleteInfo.filterText);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered.length > 0) {
          e.preventDefault();
          insertVariable(filtered[suggestionIndex].key);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setAutocompleteInfo(null);
        return;
      }
    }

    // Pass through to original onKeyDown handler
    onKeyDown?.(e);
  }, [showSuggestions, autocompleteInfo, getFilteredVariables, suggestionIndex, insertVariable, onKeyDown]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowSuggestions(false);
        setAutocompleteInfo(null);
      }
    };

    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSuggestions]);

  // Render highlighted text with variables styled (env + path)
  const renderHighlightedText = () => {
    if (!value) return null;

    const tokens = [];
    const envRegex = /\{\{[^}]+\}\}/g;
    let m;
    while ((m = envRegex.exec(value)) !== null) {
      tokens.push({ start: m.index, end: m.index + m[0].length, kind: 'env', text: m[0] });
    }
    if (pathVariables && pathVariables.length > 0) {
      for (const t of extractPathVarTokens(value)) {
        tokens.push({
          start: t.start,
          end: t.end,
          kind: 'path',
          text: value.slice(t.start, t.end),
          name: t.key,
        });
      }
    }
    tokens.sort((a, b) => a.start - b.start);

    const segments = [];
    let cursor = 0;
    for (const tok of tokens) {
      if (tok.start < cursor) continue;
      if (tok.start > cursor) segments.push({ text: value.slice(cursor, tok.start), isVar: false });
      segments.push({ text: tok.text, isVar: true, kind: tok.kind, name: tok.name });
      cursor = tok.end;
    }
    if (cursor < value.length) segments.push({ text: value.slice(cursor), isVar: false });

    return segments.map((seg, i) => {
      if (!seg.isVar) return <span key={i}>{seg.text}</span>;
      if (seg.kind === 'env') {
        const varName = seg.text.slice(2, -2).trim();
        const source = getVariableSource(varName);
        let varClass;
        if (!source && !activeEnvironment) varClass = 'no-env';
        else if (!source) varClass = 'unresolved';
        else if (source === 'collection') varClass = 'collection';
        else varClass = 'resolved';
        return <span key={i} className={`env-var-highlight ${varClass}`}>{seg.text}</span>;
      }
      // kind === 'path'
      const pv = pathVariables.find(p => p.key === seg.name);
      const varClass = pv?.value ? 'path-resolved' : 'path-unresolved';
      return <span key={i} className={`env-var-highlight ${varClass}`}>{seg.text}</span>;
    });
  };

  // Handle mouse move to detect hover over variables → show shared popover
  const handleMouseMove = (e) => {
    if (!inputRef.current || !variablePopover) return;

    const input = inputRef.current;
    const rect = input.getBoundingClientRect();
    const style = window.getComputedStyle(input);
    const paddingLeft = parseFloat(style.paddingLeft);
    const fontSize = parseFloat(style.fontSize);
    const charWidth = fontSize * 0.6;

    const relativeX = e.clientX - rect.left - paddingLeft + input.scrollLeft;
    const charPos = Math.floor(relativeX / charWidth);

    const variable = findVariableAtPosition(value, charPos);

    if (variable) {
      const varStartX = rect.left + paddingLeft + (variable.start * charWidth);
      const varEndX = rect.left + paddingLeft + (variable.end * charWidth);
      const popoverRect = { left: varStartX, right: varEndX, top: rect.top, bottom: rect.bottom };
      if (variable.kind === 'path') {
        variablePopover.show({
          varName: variable.name,
          rect: popoverRect,
          kind: 'path',
          pathVariables,
          onPathVarChange: (key, newValue) => {
            onPathVariableValueChange?.(key, newValue);
          },
        });
      } else {
        variablePopover.show({
          varName: variable.name,
          rect: popoverRect,
        });
      }
    } else {
      variablePopover.hide();
    }
  };

  const handleMouseLeave = () => {
    variablePopover?.hide();
  };

  const { 'data-testid': dataTestId, ...inputRest } = rest;

  return (
    <div className="env-variable-input-wrapper" data-testid={dataTestId}>
      {hasVariables && (
        <div className="env-var-overlay" aria-hidden="true">
          {renderHighlightedText()}
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        className={`${className} ${hasVariables ? 'has-env-vars' : ''}`}
        placeholder={placeholder}
        value={value}
        {...inputRest}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onPaste={onPaste}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        disabled={disabled}
      />

      {/* Autocomplete suggestions dropdown */}
      {showSuggestions && autocompleteInfo && (() => {
        const filtered = getFilteredVariables(autocompleteInfo.filterText);
        if (filtered.length === 0) return null;
        return (
          <div
            className="env-suggestions"
            ref={suggestionsRef}
            style={{
              position: 'fixed',
              top: suggestionsPos.top,
              left: suggestionsPos.left,
              width: suggestionsPos.width,
            }}
          >
            {filtered.map((v, i) => (
              <div
                key={v.key}
                className={`env-suggestion-item ${i === suggestionIndex ? 'selected' : ''}`}
                onClick={() => insertVariable(v.key)}
                onMouseEnter={() => setSuggestionIndex(i)}
              >
                <span className={`suggestion-source-badge ${v.source === 'collection' ? 'collection' : 'env'}`}>
                  {v.source === 'collection' ? 'C' : 'E'}
                </span>
                <span className="suggestion-key">{`{{${v.key}}}`}</span>
                <span className="suggestion-value">{v.value || '(empty)'}</span>
              </div>
            ))}
          </div>
        );
      })()}

    </div>
  );
}
