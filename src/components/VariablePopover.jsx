import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as data from '../data/index.js';

const VariablePopoverContext = createContext(null);

export function useVariablePopover() {
  return useContext(VariablePopoverContext);
}

export function VariablePopoverProvider({ children, activeEnvironment, collectionVariables, rootCollectionId, onEnvironmentUpdate }) {
  const [state, setState] = useState(null); // { varName, rect, source, value }
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const popoverRef = useRef(null);
  const hideTimeoutRef = useRef(null);
  const isPopoverHoveredRef = useRef(false);

  const getVariableSource = useCallback((varName) => {
    if (activeEnvironment?.variables?.some(v => v.key === varName && v.enabled)) return 'env';
    if (collectionVariables?.some(v => v.key === varName && v.enabled)) return 'collection';
    return null;
  }, [activeEnvironment, collectionVariables]);

  const getVariableValue = useCallback((varName) => {
    const envVar = activeEnvironment?.variables?.find(v => v.key === varName && v.enabled);
    if (envVar) return envVar.value ?? envVar.current_value ?? envVar.initial_value ?? null;
    const colVar = collectionVariables?.find(v => v.key === varName && v.enabled);
    if (colVar) return colVar.value ?? colVar.current_value ?? colVar.initial_value ?? null;
    return null;
  }, [activeEnvironment, collectionVariables]);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    if (isEditing) return;
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      if (!isPopoverHoveredRef.current) {
        setState(null);
        setIsEditing(false);
      }
    }, 150);
  }, [isEditing, clearHideTimeout]);

  const show = useCallback(({ varName, rect, kind = 'env', pathVariables: pvList, onPathVarChange }) => {
    // Don't interrupt edit mode
    if (isEditing) { clearHideTimeout(); return; }
    // Don't show while selecting text
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    clearHideTimeout();
    if (kind === 'path') {
      const pv = pvList?.find(p => p.key === varName);
      setState({
        varName,
        rect,
        kind: 'path',
        source: 'path',
        value: pv?.value ?? '',
        onPathVarChange,
      });
      setEditValue(pv?.value || '');
      return;
    }
    const source = getVariableSource(varName);
    const value = getVariableValue(varName);
    setState({ varName, rect, kind: 'env', source, value });
    setEditValue(value || '');
  }, [isEditing, getVariableSource, getVariableValue, clearHideTimeout]);

  const hide = useCallback(() => {
    if (isEditing) return;
    scheduleHide();
  }, [isEditing, scheduleHide]);

  const saveVariable = useCallback(async () => {
    if (!state) return;
    try {
      // Minify JSON before saving
      let valueToSave = editValue;
      try { valueToSave = JSON.stringify(JSON.parse(editValue)); } catch {}

      if (state.kind === 'path' && state.onPathVarChange) {
        state.onPathVarChange(state.varName, valueToSave);
        setIsEditing(false);
        setState(null);
        return;
      }

      if (state.source === 'collection' && rootCollectionId) {
        await data.updateCollectionVariableCurrentValues(rootCollectionId, {
          [state.varName]: valueToSave,
        });
        onEnvironmentUpdate?.();
      } else if (activeEnvironment) {
        const exists = activeEnvironment.variables.some(v => v.key === state.varName);
        if (!exists) {
          await data.updateEnvironment(activeEnvironment.id, {
            variables: [...activeEnvironment.variables, { key: state.varName, value: valueToSave, enabled: true }],
          });
        } else {
          await data.updateCurrentValues(activeEnvironment.id, {
            [state.varName]: valueToSave,
          });
        }
        onEnvironmentUpdate?.();
      }
    } catch (err) {
      console.error('Failed to update variable:', err);
    }
    setIsEditing(false);
    setState(null);
  }, [state, editValue, activeEnvironment, rootCollectionId, onEnvironmentUpdate]);

  // Close on outside click
  useEffect(() => {
    if (!state) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsEditing(false);
        isPopoverHoveredRef.current = false;
        setState(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [state]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); };
  }, []);

  const contextValue = { show, hide };

  // Position calculation
  const popoverPos = state ? {
    top: state.rect.bottom + 4,
    left: Math.min(
      Math.max((state.rect.left + state.rect.right) / 2, 168),
      window.innerWidth - 168
    ),
  } : null;

  return (
    <VariablePopoverContext.Provider value={contextValue}>
      {children}
      {state && (
        <div
          ref={popoverRef}
          className={`env-var-popover ${!state.source ? (!activeEnvironment ? 'no-env' : 'unresolved') : ''} ${typeof state.value === 'string' && state.value.trim().match(/^[\[{]/) ? 'has-json' : ''}`}
          style={{
            position: 'fixed',
            top: popoverPos.top,
            left: popoverPos.left,
            transform: 'translateX(-50%)',
            zIndex: 10000,
          }}
          onClick={() => {
            if (isEditing) return;
            // Format JSON for editing
            if (state?.value && typeof state.value === 'string' && state.value.trim().match(/^[\[{]/)) {
              try { setEditValue(JSON.stringify(JSON.parse(state.value), null, 2)); } catch {}
            }
            setIsEditing(true);
          }}
          onMouseEnter={() => { clearHideTimeout(); isPopoverHoveredRef.current = true; }}
          onMouseLeave={() => { isPopoverHoveredRef.current = false; if (!isEditing) scheduleHide(); }}
        >
          <div className="env-var-popover-header">
            <span className={`env-var-name ${state.source || ''}`}>
              {state.source === 'collection' && <span className="suggestion-source-badge collection">C</span>}
              {state.source === 'env' && <span className="suggestion-source-badge env">E</span>}
              {state.kind === 'path' && <span className="suggestion-source-badge path">P</span>}
              {state.varName}
            </span>
            {state.kind === 'path' ? (
              <span className="env-var-env path">Path</span>
            ) : (
              state.source !== 'collection' && (
                activeEnvironment
                  ? <span className="env-var-env">{activeEnvironment.name}</span>
                  : <span className="env-var-env no-env">No Environment</span>
              )
            )}
          </div>
          {(() => {
            const isJson = typeof state.value === 'string' && state.value.trim().match(/^[\[{]/);
            let formattedValue = state.value;
            if (isJson) {
              try { formattedValue = JSON.stringify(JSON.parse(state.value), null, 2); } catch {}
            }

            if (isEditing) {
              return (
                <div className="env-var-popover-edit">
                  {isJson ? (
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setIsEditing(false); setState(null); }
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveVariable(); }
                      }}
                      autoFocus
                      placeholder="Enter JSON value..."
                      className="env-var-popover-textarea"
                    />
                  ) : (
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveVariable(); }
                        if (e.key === 'Escape') { setIsEditing(false); setState(null); }
                      }}
                      autoFocus
                      placeholder="Enter value..."
                    />
                  )}
                  <button onClick={saveVariable}>Save</button>
                </div>
              );
            }

            if (state.value !== null && state.value !== undefined) {
              return (
                <div className="env-var-popover-value">
                  {isJson ? (
                    <pre className="env-var-popover-json">{formattedValue}</pre>
                  ) : (
                    state.value || <span className="empty">(empty string)</span>
                  )}
                  <span className="edit-hint">Click to edit{isJson ? ' (Ctrl+Enter to save)' : ''}</span>
                </div>
              );
            }

            // No value — show warning
            if (!activeEnvironment) {
              return (
                <div className="env-var-popover-value">
                  <span className="warning">Select an environment to use variables</span>
                </div>
              );
            }
            return (
              <div className="env-var-popover-value">
                <span className="warning">Variable not found in "{activeEnvironment.name}"</span>
                <span className="edit-hint">Click to create it</span>
              </div>
            );
          })()}
        </div>
      )}
    </VariablePopoverContext.Provider>
  );
}
