import { useState, useEffect, useMemo, useCallback } from 'react';
import { FolderOpen, Folder, Clock, User, Hash, Plus, Trash2, Save, Shield, Code } from 'lucide-react';
import { ScriptEditor } from './ScriptEditor';
import * as data from '../data/index.js';

const AUTH_TYPES = [
  { value: 'none', label: 'No Auth' },
  { value: 'inherit', label: 'Inherit from Parent' },
  { value: 'bearer', label: 'Bearer Token' },
];

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

function VariablesTab({ collectionId, canEdit }) {
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
      const vars = editingVars.filter(v => v.key.trim());
      const existingKeys = new Set(variables.map(v => v.key));
      const newVars = vars.filter((v, i) => newVarIndices.has(i) && !existingKeys.has(v.key));

      if (canEdit) {
        const allVars = vars.map(v => {
          const isNew = newVarIndices.has(editingVars.indexOf(v)) && !existingKeys.has(v.key);
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
          {hasChanges && (
            <button className="btn-primary small" onClick={handleSave} disabled={saving}>
              <Save size={13} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="collection-variables-table-wrapper">
        <table className="collection-variables-table">
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
            {editingVars.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 3 : 2} className="empty-state">
                  No variables defined
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <button className="btn-secondary small add-var-btn" onClick={addVar}>
          <Plus size={13} />
          Add Variable
        </button>
      )}
    </div>
  );
}

function AuthTab({ authType, authToken, onChange, canEdit }) {
  return (
    <div className="collection-auth-tab">
      <div className="collection-auth-type">
        <label>Authorization Type</label>
        <select
          value={authType || 'none'}
          onChange={e => onChange({ auth_type: e.target.value })}
          disabled={!canEdit}
        >
          {AUTH_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {authType === 'bearer' && (
        <div className="collection-auth-token">
          <label>Token</label>
          <input
            type="text"
            placeholder="Enter bearer token or {{variable}}"
            value={authToken || ''}
            onChange={e => onChange({ auth_token: e.target.value })}
            disabled={!canEdit}
          />
        </div>
      )}

      {authType === 'inherit' && (
        <div className="collection-auth-inherit-notice">
          Authorization will be inherited from the parent collection.
        </div>
      )}

      {authType === 'none' && (
        <div className="collection-auth-inherit-notice">
          No authorization is set. Requests in this collection will use their own auth settings.
        </div>
      )}
    </div>
  );
}

function ScriptsTab({ preScript, postScript, onChange, canEdit }) {
  return (
    <div className="collection-scripts-tab">
      <div className="collection-script-section">
        <div className="collection-script-header">
          <label>Pre-request Script</label>
          <span className="collection-script-hint">Runs before every request in this collection</span>
        </div>
        <ScriptEditor
          value={preScript || ''}
          onChange={val => onChange({ pre_script: val })}
          placeholder="// Pre-request script runs before every request in this collection..."
          readOnly={!canEdit}
        />
      </div>

      <div className="collection-script-section">
        <div className="collection-script-header">
          <label>Post-response Script</label>
          <span className="collection-script-hint">Runs after every request in this collection</span>
        </div>
        <ScriptEditor
          value={postScript || ''}
          onChange={val => onChange({ post_script: val })}
          placeholder="// Post-response script runs after every request in this collection..."
          readOnly={!canEdit}
        />
      </div>
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: FolderOpen },
  { id: 'authorization', label: 'Auth', icon: Shield },
  { id: 'scripts', label: 'Scripts', icon: Code },
];

export function CollectionEditor({
  collection,
  activeDetailTab,
  onActiveDetailTabChange,
  onCollectionChange,
  canEdit,
  onSave,
  dirty,
}) {
  const [fullCollection, setFullCollection] = useState(null);
  const [requestCount, setRequestCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(true);
  const isRoot = !collection?.parent_id;

  // Tabs: root collections get a "Variables" tab
  const tabs = useMemo(() => {
    if (isRoot) {
      return [...TABS.slice(0, 1), { id: 'variables', label: 'Variables', icon: Hash }, ...TABS.slice(1)];
    }
    return TABS;
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
        {dirty && canEdit && (
          <button className="btn-primary small" onClick={onSave}>
            <Save size={13} />
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
          />
        )}

        {activeDetailTab === 'authorization' && (
          <AuthTab
            authType={collection.auth_type || 'none'}
            authToken={collection.auth_token || ''}
            onChange={handleAuthChange}
            canEdit={canEdit}
          />
        )}

        {activeDetailTab === 'scripts' && (
          <ScriptsTab
            preScript={collection.pre_script || ''}
            postScript={collection.post_script || ''}
            onChange={handleScriptChange}
            canEdit={canEdit}
          />
        )}
      </div>
    </div>
  );
}
