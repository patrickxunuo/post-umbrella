import { useState, useEffect, useMemo, useCallback } from 'react';
import { FolderOpen, Folder, Clock, User, Hash, Plus, Trash2, Save, Shield, Code } from 'lucide-react';
import { ScriptEditor } from './ScriptEditor';
import { EnvVariableInput } from './EnvVariableInput';
import * as data from '../data/index.js';


function formatDate(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function OverviewTab({ collection, requestCount, loading }) {
  const isFolder = !!collection.parent_id;

  return (
    <div className="collection-overview">
      <div className="collection-overview-header">
        <div className="collection-overview-icon">
          {isFolder ? <Folder size={28} /> : <FolderOpen size={28} />}
        </div>
        <div className="collection-overview-title">
          <h2>{collection.name}</h2>
          <span className="collection-overview-type">{isFolder ? 'Folder' : 'Collection'}</span>
        </div>
      </div>

      <div className="collection-overview-stats">
        <div className="collection-stat">
          <User size={15} />
          <span className="collection-stat-label">Created by</span>
          <span className="collection-stat-value">{collection.created_by_email || '—'}</span>
        </div>
        <div className="collection-stat">
          <Hash size={15} />
          <span className="collection-stat-label">Total requests</span>
          <span className="collection-stat-value">
            {loading ? '...' : requestCount}
          </span>
        </div>
        <div className="collection-stat">
          <Clock size={15} />
          <span className="collection-stat-label">Last updated</span>
          <span className="collection-stat-value">{formatDate(collection.updated_at)}</span>
        </div>
        <div className="collection-stat">
          <Clock size={15} />
          <span className="collection-stat-label">Created</span>
          <span className="collection-stat-value">{formatDate(collection.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

function VariablesTab({ collectionId, canEdit, onEnvironmentUpdate }) {
  const [variables, setVariables] = useState([]);
  const [editingVars, setEditingVars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newVarIndices, setNewVarIndices] = useState(new Set());

  useEffect(() => {
    loadVariables();
  }, [collectionId]);

  const loadVariables = async () => {
    setLoading(true);
    try {
      const vars = await data.getCollectionVariables(collectionId);
      setVariables(vars);
      setEditingVars(vars.map(v => ({ ...v })));
      setNewVarIndices(new Set());
    } finally {
      setLoading(false);
    }
  };

  const hasChanges = useMemo(() => {
    const aNorm = editingVars.filter(v => v.key?.trim());
    const bNorm = variables.filter(v => v.key?.trim());
    if (aNorm.length !== bNorm.length) return true;
    return aNorm.some((v, i) => {
      const b = bNorm[i];
      if (!b) return true;
      return v.key !== b.key || (v.value || '') !== (b.value || '');
    });
  }, [editingVars, variables]);

  const updateVar = (index, field, value) => {
    setEditingVars(vars => vars.map((v, i) => i === index ? { ...v, [field]: value } : v));
  };

  const addVar = () => {
    const newIndex = editingVars.length;
    setEditingVars(v => [...v, { key: '', value: '' }]);
    setNewVarIndices(prev => new Set([...prev, newIndex]));
  };

  const removeVar = (index) => {
    setEditingVars(vars => vars.filter((_, i) => i !== index));
    setNewVarIndices(prev => {
      const updated = new Set();
      prev.forEach(i => {
        if (i < index) updated.add(i);
        else if (i > index) updated.add(i - 1);
      });
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const vars = editingVars.filter(v => v.key.trim()).map(v => ({ ...v, key: v.key.trim(), value: (v.value || '').trim() }));
      const existingKeys = new Set(variables.map(v => v.key));
      const newVars = vars.filter((v, i) => newVarIndices.has(i) && !existingKeys.has(v.key));

      if (canEdit) {
        const allVars = vars.map(v => {
          const isNew = !existingKeys.has(v.key);
          const original = variables.find(ov => ov.key === v.key);
          return {
            key: v.key,
            initial_value: isNew ? v.value : (original?.initial_value || ''),
            enabled: true,
          };
        });
        const updated = await data.saveCollectionVariables(collectionId, allVars);
        setVariables(updated);
        setEditingVars(updated.map(v => ({ ...v })));
        setNewVarIndices(new Set());
      }

      // Save current_value changes
      const currentValues = {};
      const newVarKeys = new Set(newVars.map(v => v.key));
      vars.forEach(v => {
        if (newVarKeys.has(v.key)) return;
        const original = variables.find(ov => ov.key === v.key);
        const initialVal = original?.initial_value || '';
        currentValues[v.key] = v.value !== initialVal ? v.value : null;
      });
      if (Object.keys(currentValues).length > 0) {
        await data.updateCollectionVariableCurrentValues(collectionId, currentValues);
      }

      if (!canEdit) {
        // Non-admin: just refresh
        await loadVariables();
      }
      onEnvironmentUpdate?.();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="collection-tab-loading">Loading variables...</div>;
  }

  return (
    <div className="collection-variables-tab">
      <div className="collection-variables-header">
        <span className="collection-variables-hint">
          Collection variables are shared across all requests. Use <code>{'{{key}}'}</code> to reference them.
        </span>
        <div className="collection-variables-actions">
          <button className="btn-primary small" onClick={handleSave} disabled={!hasChanges || saving}>
            <Save size={13} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="env-var-table">
        <table>
          <thead>
            <tr>
              <th className="col-key">Variable</th>
              <th className="col-value">Value</th>
              {canEdit && <th className="col-actions" />}
            </tr>
          </thead>
          <tbody>
            {editingVars.map((v, index) => (
              <tr key={index}>
                <td className="col-key">
                  <input
                    type="text"
                    placeholder="Variable name"
                    value={v.key}
                    onChange={e => updateVar(index, 'key', e.target.value)}
                    disabled={!canEdit && !newVarIndices.has(index)}
                  />
                </td>
                <td className="col-value">
                  <input
                    type="text"
                    placeholder="Value"
                    value={v.value || ''}
                    onChange={e => updateVar(index, 'value', e.target.value)}
                  />
                </td>
                {canEdit && (
                  <td className="col-actions">
                    <button className="btn-icon small" onClick={() => removeVar(index)} title="Remove">
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!editingVars.length && <tr className="empty-row"><td colSpan={canEdit ? 3 : 2}>No variables yet</td></tr>}
          </tbody>
        </table>
        {canEdit && (
          <button className="btn-add-var" onClick={addVar}>
            <Plus size={14} />Add Variable
          </button>
        )}
      </div>
    </div>
  );
}

function AuthTab({ authType, authToken, onChange, canEdit, isFolder, activeEnvironment, collectionVariables, rootCollectionId, onEnvironmentUpdate }) {
  const handleAuthTypeChange = (type) => {
    if (!canEdit) return;
    onChange({ auth_type: type });
  };

  return (
    <div className="auth-editor">
      <div className="option-selector auth-type-selector">
        <label>
          <input
            type="radio"
            name="collectionAuthType"
            value="none"
            checked={authType === 'none'}
            onChange={() => handleAuthTypeChange('none')}
            disabled={!canEdit}
          />
          No Auth
        </label>
        {isFolder && (
          <label>
            <input
              type="radio"
              name="collectionAuthType"
              value="inherit"
              checked={authType === 'inherit'}
              onChange={() => handleAuthTypeChange('inherit')}
              disabled={!canEdit}
            />
            Inherit from Parent
          </label>
        )}
        <label>
          <input
            type="radio"
            name="collectionAuthType"
            value="bearer"
            checked={authType === 'bearer'}
            onChange={() => handleAuthTypeChange('bearer')}
            disabled={!canEdit}
          />
          Bearer Token
        </label>
      </div>
      {authType === 'inherit' && (
        <p className="hint" style={{ marginTop: 8 }}>
          Authorization will be inherited from the parent collection's auth settings.
        </p>
      )}
      {authType === 'bearer' && (
        <div className="auth-token-input">
          <label>Token</label>
          <EnvVariableInput
            className="auth-token-field"
            placeholder="Enter bearer token or {{variable}}"
            value={authToken || ''}
            onChange={(e) => onChange({ auth_token: e.target.value })}
            disabled={!canEdit}
            activeEnvironment={activeEnvironment}
            collectionVariables={collectionVariables}
            rootCollectionId={rootCollectionId}
            onEnvironmentUpdate={onEnvironmentUpdate}
          />
          <p className="hint">
            The token will be sent as: Authorization: Bearer &lt;token&gt;
          </p>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: FolderOpen },
  { id: 'authorization', label: 'Auth', icon: Shield },
  { id: 'pre-script', label: 'Pre-script', icon: Code },
  { id: 'post-script', label: 'Post-script', icon: Code },
];

export function CollectionEditor({
  collection,
  activeDetailTab,
  onActiveDetailTabChange,
  onCollectionChange,
  canEdit,
  onSave,
  dirty,
  activeEnvironment,
  collectionVariables,
  rootCollectionId,
  onEnvironmentUpdate,
}) {
  const [fullCollection, setFullCollection] = useState(null);
  const [requestCount, setRequestCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(true);
  const isRoot = !collection?.parent_id;

  // Tabs: root collections get Variables + Scripts; folders get only Overview + Auth
  const tabs = useMemo(() => {
    if (isRoot) {
      return [...TABS.slice(0, 1), { id: 'variables', label: 'Variables', icon: Hash }, ...TABS.slice(1)];
    }
    // Folders: no scripts
    return TABS.filter(t => t.id !== 'pre-script' && t.id !== 'post-script');
  }, [isRoot]);

  useEffect(() => {
    if (!collection?.id) return;
    let cancelled = false;

    const load = async () => {
      try {
        const [full, count] = await Promise.all([
          data.getCollection(collection.id),
          data.getCollectionRequestCount(collection.id),
        ]);
        if (cancelled) return;
        setFullCollection(full);
        setRequestCount(count);
        setLoadingCount(false);

        // Initialize original state for dirty tracking
        if (onCollectionChange && full) {
          onCollectionChange({
            auth_type: full.auth_type || 'none',
            auth_token: full.auth_token || '',
            pre_script: full.pre_script || '',
            post_script: full.post_script || '',
          }, true);
        }
      } catch (err) {
        console.error('Failed to load collection:', err);
      }
    };
    load();

    return () => { cancelled = true; };
  }, [collection?.id]);

  const handleAuthChange = useCallback((updates) => {
    onCollectionChange?.(updates);
  }, [onCollectionChange]);

  const handleScriptChange = useCallback((updates) => {
    onCollectionChange?.(updates);
  }, [onCollectionChange]);

  if (!collection) return null;

  const displayCollection = fullCollection || collection;

  return (
    <div className="collection-editor">
      <div className="collection-editor-tabs">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`collection-editor-tab ${activeDetailTab === tab.id ? 'active' : ''}`}
              onClick={() => onActiveDetailTabChange(tab.id)}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
        <div className="collection-editor-tabs-spacer" />
        {canEdit && activeDetailTab !== 'variables' && (
          <button className="btn-primary compact" onClick={onSave} disabled={!dirty}>
            <Save size={12} />
            Save
          </button>
        )}
      </div>

      <div className="collection-editor-content">
        {activeDetailTab === 'overview' && (
          <OverviewTab
            collection={displayCollection}
            requestCount={requestCount}
            loading={loadingCount}
          />
        )}

        {activeDetailTab === 'variables' && isRoot && (
          <VariablesTab
            collectionId={collection.id}
            canEdit={canEdit}
            onEnvironmentUpdate={onEnvironmentUpdate}
          />
        )}

        {activeDetailTab === 'authorization' && (
          <AuthTab
            authType={collection.auth_type || 'none'}
            authToken={collection.auth_token || ''}
            onChange={handleAuthChange}
            canEdit={canEdit}
            isFolder={!isRoot}
            activeEnvironment={activeEnvironment}
            collectionVariables={collectionVariables}
            rootCollectionId={rootCollectionId}
            onEnvironmentUpdate={onEnvironmentUpdate}
          />
        )}

        {activeDetailTab === 'pre-script' && (
          <div className="script-panel">
            <div className="script-help">
              <p>Pre-request script runs before every request in this collection. Use it to set variables or modify request data.</p>
              <details>
                <summary>Available API</summary>
                <pre>{`// Environment variables
pm.environment.get("varName")
pm.environment.set("varName", "value")

// Collection variables
pm.collectionVariables.get("varName")
pm.collectionVariables.set("varName", "value")

// Access request data
pm.request.url
pm.request.method
pm.request.headers

// Console logging
console.log("message")`}</pre>
              </details>
            </div>
            <ScriptEditor
              value={collection.pre_script || ''}
              onChange={val => handleScriptChange({ pre_script: val })}
              placeholder="// Pre-request script runs before every request in this collection..."
              readOnly={!canEdit}
            />
          </div>
        )}

        {activeDetailTab === 'post-script' && (
          <div className="script-panel">
            <div className="script-help">
              <p>Post-response script runs after every request in this collection. Use it to extract data and set variables.</p>
              <details>
                <summary>Available API</summary>
                <pre>{`// Environment variables
pm.environment.get("varName")
pm.environment.set("varName", "value")

// Collection variables
pm.collectionVariables.get("varName")
pm.collectionVariables.set("varName", "value")

// Access response data
const json = pm.response.json();
pm.response.code    // status code
pm.response.body    // raw body
pm.response.headers

// Example: Extract token from response
const data = pm.response.json();
pm.environment.set("authToken", data.token);

// Console logging
console.log("message")`}</pre>
              </details>
            </div>
            <ScriptEditor
              value={collection.post_script || ''}
              onChange={val => handleScriptChange({ post_script: val })}
              placeholder="// Post-response script runs after every request in this collection..."
              readOnly={!canEdit}
            />
          </div>
        )}
      </div>
    </div>
  );
}
