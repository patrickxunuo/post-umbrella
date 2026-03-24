import { useState, useRef, useEffect, useCallback } from 'react';
import * as data from '../data/index.js';

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
  disabled = false,
}) {
  const [hoveredVar, setHoveredVar] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [editValue, setEditValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isPopoverHovered, setIsPopoverHovered] = useState(false);
  // Autocomplete state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [autocompleteInfo, setAutocompleteInfo] = useState(null); // { start, filterText }
  const [suggestionsPos, setSuggestionsPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const popoverRef = useRef(null);
  const suggestionsRef = useRef(null);
  const hideTimeoutRef = useRef(null);

  // Find the variable at a given position in the text
  const findVariableAtPosition = (text, pos) => {
    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;
      if (pos >= start && pos <= end) {
        return {
          name: match[1],
          start,
          end,
          fullMatch: match[0],
        };
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

  // Check if the value contains any variables
  const hasVariables = /\{\{[^}]+\}\}/.test(value);

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

  // Render highlighted text with variables styled
  const renderHighlightedText = () => {
    if (!value) return null;

    const parts = [];
    const regex = /(\{\{[^}]+\}\})/g;
    const segments = value.split(regex);

    segments.forEach((segment, index) => {
      if (segment.match(/^\{\{[^}]+\}\}$/)) {
        // This is a variable
        const varName = segment.slice(2, -2);
        const source = getVariableSource(varName);
        let varClass;
        if (!source && !activeEnvironment) varClass = 'no-env';
        else if (!source) varClass = 'unresolved';
        else if (source === 'collection') varClass = 'collection';
        else varClass = 'resolved';
        parts.push(
          <span key={index} className={`env-var-highlight ${varClass}`}>
            {segment}
          </span>
        );
      } else if (segment) {
        // Regular text
        parts.push(<span key={index}>{segment}</span>);
      }
    });

    return parts;
  };

  // Clear any pending hide timeout
  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Schedule hiding the popover with a delay
  const scheduleHide = useCallback(() => {
    if (isEditing) return;
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      if (!isEditing && !isPopoverHovered) {
        setHoveredVar(null);
      }
    }, 150);
  }, [isEditing, isPopoverHovered, clearHideTimeout]);

  // Handle mouse move to detect hover over variables
  const handleMouseMove = (e) => {
    if (!inputRef.current || isEditing) return;

    const input = inputRef.current;
    const rect = input.getBoundingClientRect();

    // Calculate approximate character position based on mouse position
    const style = window.getComputedStyle(input);
    const paddingLeft = parseFloat(style.paddingLeft);
    const fontSize = parseFloat(style.fontSize);
    const charWidth = fontSize * 0.6; // Approximate character width

    const relativeX = e.clientX - rect.left - paddingLeft + input.scrollLeft;
    const charPos = Math.floor(relativeX / charWidth);

    const variable = findVariableAtPosition(value, charPos);

    if (variable) {
      clearHideTimeout();
      // Only update position if it's a different variable
      if (!hoveredVar || hoveredVar.name !== variable.name || hoveredVar.start !== variable.start) {
        setHoveredVar(variable);
        setEditValue(getVariableValue(variable.name) || '');

        // Position the popover below the variable (fixed position based on variable location)
        const varStartX = rect.left + paddingLeft + (variable.start * charWidth);
        const varEndX = rect.left + paddingLeft + (variable.end * charWidth);
        const varCenterX = (varStartX + varEndX) / 2;

        // Keep popover within viewport (320px max width, centered)
        const popoverHalfWidth = 160;
        const viewportWidth = window.innerWidth;
        const clampedLeft = Math.min(
          Math.max(varCenterX, popoverHalfWidth + 8),
          viewportWidth - popoverHalfWidth - 8
        );

        setPopoverPos({
          top: rect.bottom + 4,
          left: clampedLeft,
        });
      }
    } else {
      scheduleHide();
    }
  };

  const handleMouseLeave = () => {
    scheduleHide();
  };

  const handlePopoverMouseEnter = () => {
    clearHideTimeout();
    setIsPopoverHovered(true);
  };

  const handlePopoverMouseLeave = () => {
    setIsPopoverHovered(false);
    if (!isEditing) {
      scheduleHide();
    }
  };

  // Handle clicking on the popover to start editing
  const handlePopoverClick = () => {
    setIsEditing(true);
  };

  // Save the variable value
  const saveVariable = async () => {
    if (!hoveredVar) return;

    const source = getVariableSource(hoveredVar.name);

    try {
      if (source === 'collection' && rootCollectionId) {
        await data.updateCollectionVariableCurrentValues(rootCollectionId, {
          [hoveredVar.name]: editValue,
        });
        onEnvironmentUpdate?.();
      } else if (activeEnvironment) {
        const exists = activeEnvironment.variables.some(v => v.key === hoveredVar.name);
        if (!exists) {
          const updatedVariables = [
            ...activeEnvironment.variables,
            { key: hoveredVar.name, value: editValue, enabled: true },
          ];
          await data.updateEnvironment(activeEnvironment.id, {
            variables: updatedVariables,
          });
        } else {
          await data.updateCurrentValues(activeEnvironment.id, {
            [hoveredVar.name]: editValue,
          });
        }
        onEnvironmentUpdate?.();
      }
    } catch (err) {
      console.error('Failed to update variable:', err);
    }

    setIsEditing(false);
    setHoveredVar(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveVariable();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setHoveredVar(null);
    }
  };

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setIsEditing(false);
        setIsPopoverHovered(false);
        setHoveredVar(null);
      }
    };

    if (hoveredVar) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [hoveredVar]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="env-variable-input-wrapper">
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

      {hoveredVar && (
        <div
          ref={popoverRef}
          className={`env-var-popover ${!variableExists(hoveredVar.name) ? (!activeEnvironment ? 'no-env' : 'unresolved') : ''}`}
          style={{
            position: 'fixed',
            top: popoverPos.top,
            left: popoverPos.left,
            transform: 'translateX(-50%)',
          }}
          onClick={handlePopoverClick}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        >
          <div className="env-var-popover-header">
            <span className={`env-var-name ${getVariableSource(hoveredVar.name) || ''}`}>
              {(() => {
                const source = getVariableSource(hoveredVar.name);
                if (source === 'collection') {
                  return <span className="suggestion-source-badge collection">C</span>;
                }
                if (source === 'env') {
                  return <span className="suggestion-source-badge env">E</span>;
                }
                return null;
              })()}
              {hoveredVar.name}
            </span>
            {(() => {
              const source = getVariableSource(hoveredVar.name);
              if (source === 'collection') return null;
              if (activeEnvironment) {
                return <span className="env-var-env">{activeEnvironment.name}</span>;
              }
              return <span className="env-var-env no-env">No Environment</span>;
            })()}
          </div>
          {isEditing ? (
            <div className="env-var-popover-edit">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                placeholder="Enter value..."
              />
              <button onClick={saveVariable}>Save</button>
            </div>
          ) : getVariableValue(hoveredVar.name) !== null ? (
            <div className="env-var-popover-value">
              {getVariableValue(hoveredVar.name) || <span className="empty">(empty string)</span>}
              <span className="edit-hint">Click to edit</span>
            </div>
          ) : !activeEnvironment ? (
            <div className="env-var-popover-value">
              <span className="warning">Select an environment to use variables</span>
            </div>
          ) : (
            <div className="env-var-popover-value">
              <span className="warning">Variable not found in "{activeEnvironment.name}"</span>
              <span className="edit-hint">Click to create it</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
