import { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Edit2, Copy, ChevronRight } from 'lucide-react';
import * as data from '../data/index.js';
import { useConfirm } from './ConfirmModal';
import { usePrompt } from './PromptModal';
import { DropdownMenu } from './DropdownMenu';

const normalizeVar = (v) => ({
  key: v.key || '',
  value: v.value || '',
});

const varsEqual = (a, b) => {
  const aNorm = a.filter(v => v.key?.trim()).map(normalizeVar);
  const bNorm = b.filter(v => v.key?.trim()).map(normalizeVar);
  if (aNorm.length !== bNorm.length) return false;
  return aNorm.every((v, i) => v.key === bNorm[i].key && v.value === bNorm[i].value);
};

const VariableRow = ({ v, index, canEdit, isNewVar, onUpdate, onRemove }) => (
  <tr>
    <td className="col-key">
      <input
        type="text"
        placeholder="Variable name"
        value={v.key}
        onChange={e => onUpdate(index, 'key', e.target.value)}
        disabled={!canEdit && !isNewVar}
      />
    </td>
    <td className="col-value">
      <input
        type="text"
        placeholder="Value"
        value={v.value || ''}
        onChange={e => onUpdate(index, 'value', e.target.value)}
      />
    </td>
    {canEdit && (
      <td className="col-actions">
        <button className="btn-icon small" onClick={() => onRemove(index)} title="Remove">
          <Trash2 size={14} />
        </button>
      </td>
    )}
  </tr>
);

export function EnvironmentEditor({ onClose, workspaceId, workspaceName, canEdit = false }) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [environments, setEnvironments] = useState([]);
  const [selectedEnv, setSelectedEnv] = useState(null);
  const [editingVars, setEditingVars] = useState([]);
  const [newVarIndices, setNewVarIndices] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const hasChanges = useMemo(() => {
    if (!selectedEnv) return false;
    return !varsEqual(editingVars, selectedEnv.variables || []);
  }, [editingVars, selectedEnv]);

  useEffect(() => {
    workspaceId && loadEnvironments(true);
  }, [workspaceId]);

  const loadEnvironments = async (autoSelect = false) => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const envs = await data.getEnvironments(workspaceId);
      setEnvironments(envs);
      if (autoSelect && envs.length > 0) {
        const env = envs.find(e => e.is_active) || envs[0];
        setSelectedEnv(env);
        setEditingVars(env.variables.map(v => ({ ...v })));
      }
    } finally {
      setLoading(false);
    }
  };

  const confirmDiscard = async () => {
    if (!hasChanges) return true;
    return confirm({
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Discard them?',
      confirmText: 'Discard',
      variant: 'danger',
    });
  };

  const selectEnv = (env) => {
    setSelectedEnv(env);
    setEditingVars(env.variables.map(v => ({ ...v })));
    setNewVarIndices(new Set());
  };

  const handleSelectEnv = async (env) => {
    if (await confirmDiscard()) selectEnv(env);
  };

  const updateVar = (index, field, value) => {
    setEditingVars(vars => vars.map((v, i) => i === index ? { ...v, [field]: value } : v));
  };

  const addVar = () => {
    const newIndex = editingVars.length;
    setEditingVars(v => [...v, { key: '', value: '' }]);
    setNewVarIndices(prev => new Set([...prev, newIndex]));
  };

  const removeVar = (index) => {
    if (!canEdit) return;
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
    if (!selectedEnv) return;
    setSaving(true);
    try {
      const vars = editingVars.filter(v => v.key.trim()).map(v => ({ ...v, key: v.key.trim(), value: (v.value || '').trim() }));
      const existingKeys = new Set(selectedEnv.variables.map(v => v.key));

      // Check if there are new variables to create
      const newVars = vars.filter((v, i) => newVarIndices.has(i) && !existingKeys.has(v.key));

      // Check if any variables were deleted
      const currentKeys = new Set(vars.map(v => v.key));
      const deletedVars = selectedEnv.variables.filter(v => !currentKeys.has(v.key));

      if (canEdit && (newVars.length > 0 || deletedVars.length > 0)) {
        // Admin: pass all current variables to updateEnvironment
        // It will detect additions and deletions
        const allVars = vars.map(v => {
          const isNew = !existingKeys.has(v.key);
          const original = selectedEnv.variables.find(ov => ov.key === v.key);
          return {
            key: v.key,
            initial_value: isNew ? v.value : (original?.initial_value || ''),
          };
        });
        await data.updateEnvironment(selectedEnv.id, {
          name: selectedEnv.name,
          variables: allVars,
        });
      }

      // Everyone (admin and non-admin): save value changes to current_value
      const currentValues = {};
      const newVarKeys = new Set(newVars.map(v => v.key));
      vars.forEach(v => {
        // Skip newly created variables (their initial_value IS their value)
        if (newVarKeys.has(v.key)) return;

        const original = selectedEnv.variables.find(ov => ov.key === v.key);
        const initialVal = original?.initial_value || '';
        // Save to current_value if different from initial
        currentValues[v.key] = v.value !== initialVal ? v.value : null;
      });
      if (Object.keys(currentValues).length > 0) {
        await data.updateCurrentValues(selectedEnv.id, currentValues);
      }

      // Ensure vars have enabled flag for substitution to work
      const varsWithEnabled = vars.map(v => ({ ...v, enabled: true }));
      setEnvironments(envs => envs.map(e => e.id === selectedEnv.id ? { ...e, variables: varsWithEnabled } : e));
      setSelectedEnv(prev => ({ ...prev, variables: varsWithEnabled }));
      setEditingVars(varsWithEnabled);
      setNewVarIndices(new Set());
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!workspaceId || !canEdit) return;
    const name = await prompt({
      title: 'New Environment',
      message: 'Enter a name for the new environment:',
      defaultValue: 'New Environment',
    });
    if (name) {
      const env = await data.createEnvironment({ name, variables: [], workspace_id: workspaceId });
      setEnvironments(prev => [...prev, env]);
      selectEnv(env);
    }
  };

  const handleDelete = async (envId) => {
    if (!canEdit) return;
    const env = environments.find(e => e.id === envId);
    if (await confirm({
      title: 'Delete Environment',
      message: `Delete "${env?.name}"? This affects all users.`,
      confirmText: 'Delete',
      variant: 'danger',
    })) {
      await data.deleteEnvironment(envId);
      const remaining = environments.filter(e => e.id !== envId);
      setEnvironments(remaining);
      if (selectedEnv?.id === envId) {
        remaining.length ? selectEnv(remaining[0]) : (setSelectedEnv(null), setEditingVars([]));
      }
    }
  };

  const handleRename = async (envId) => {
    if (!canEdit) return;
    const env = environments.find(e => e.id === envId);
    const name = await prompt({
      title: 'Rename Environment',
      message: 'Enter a new name:',
      defaultValue: env?.name,
    });
    if (name && name !== env?.name) {
      await data.updateEnvironment(env.id, { name });
      setEnvironments(envs => envs.map(e => e.id === env.id ? { ...e, name } : e));
      if (selectedEnv?.id === env.id) setSelectedEnv(prev => ({ ...prev, name }));
    }
  };

  const handleDuplicate = async (envId) => {
    if (!canEdit) return;
    const env = environments.find(e => e.id === envId);
    if (!env) return;
    const newEnv = await data.createEnvironment({
      name: `${env.name} - copy`,
      variables: env.variables?.map(({ key, initial_value, value, enabled }) => ({ key, initial_value: initial_value || value, enabled })) || [],
      workspace_id: workspaceId,
    });
    setEnvironments(prev => [...prev, newEnv]);
    selectEnv(newEnv);
  };

  const handleClose = async () => {
    if (await confirmDiscard()) {
      setIsClosing(true);
      setTimeout(onClose, 200);
    }
  };

  const menuItems = (env) => canEdit ? [
    { icon: <Edit2 size={14} />, label: 'Rename', onClick: () => handleRename(env.id) },
    { icon: <Copy size={14} />, label: 'Duplicate', onClick: () => handleDuplicate(env.id) },
    { type: 'divider' },
    { icon: <Trash2 size={14} />, label: 'Delete', variant: 'danger', onClick: () => handleDelete(env.id) },
  ] : [];

  const closingClass = isClosing ? 'closing' : '';

  return (
    <div className={`env-drawer-overlay ${closingClass}`} onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className={`env-drawer ${closingClass}`}>
        <div className="env-drawer-header">
          <div className="env-drawer-title">
            <h2>Environments</h2>
            {workspaceName && <span className="env-drawer-workspace">{workspaceName}</span>}
          </div>
          <button className="btn-icon" onClick={handleClose} title="Close"><X size={18} /></button>
        </div>

        <div className="env-drawer-body">
          {!workspaceId ? (
            <div className="env-no-collection"><p>Select a workspace to manage environments.</p></div>
          ) : (
            <>
              <div className="env-drawer-sidebar">
                <div className="env-list-header">
                  <span>Environments</span>
                  {canEdit && <button className="btn-icon small" onClick={handleCreate} title="Add"><Plus size={16} /></button>}
                </div>
                {loading ? (
                  <div className="env-loading">Loading...</div>
                ) : !environments.length ? (
                  <div className="env-empty">
                    <p>No environments yet</p>
                    {canEdit && <button className="btn-create-first" onClick={handleCreate}>Create Environment</button>}
                  </div>
                ) : (
                  <div className="env-items">
                    {environments.map(env => (
                      <div key={env.id} className={`env-item ${selectedEnv?.id === env.id ? 'selected' : ''}`} onClick={() => handleSelectEnv(env)}>
                        <div className="env-item-info">
                          <span className="env-name">{env.name}</span>
                          <span className="env-item-meta">{env.variables?.length || 0} vars</span>
                        </div>
                        <ChevronRight size={14} className="env-item-chevron" />
                        {canEdit && <DropdownMenu items={menuItems(env)} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="env-drawer-content">
                {selectedEnv ? (
                  <>
                    <div className="env-var-header">
                      <span className="env-var-title">{selectedEnv.name}</span>
                      {canEdit && <button className="btn-icon small" onClick={() => handleRename(selectedEnv.id)} title="Rename"><Edit2 size={14} /></button>}
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
                          {editingVars.map((v, i) => (
                            <VariableRow key={i} v={v} index={i} canEdit={canEdit} isNewVar={newVarIndices.has(i)} onUpdate={updateVar} onRemove={removeVar} />
                          ))}
                          {!editingVars.length && <tr className="empty-row"><td colSpan={canEdit ? 3 : 2}>No variables yet</td></tr>}
                        </tbody>
                      </table>
                      <button className="btn-add-var" onClick={addVar}>
                        <Plus size={14} />Add Variable
                      </button>
                    </div>
                    <div className="env-var-footer">
                      <button className="btn-save" onClick={handleSave} disabled={saving || !hasChanges}>
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="env-var-empty">
                    {environments.length ? 'Select an environment' : canEdit ? 'Create an environment' : 'No environments'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
