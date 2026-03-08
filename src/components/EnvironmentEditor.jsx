import { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Edit2, Copy } from 'lucide-react';
import * as data from '../data/index.js';
import { useConfirm } from './ConfirmModal';
import { usePrompt } from './PromptModal';
import { DropdownMenu } from './DropdownMenu';

export function EnvironmentEditor({ onClose, collectionId, collectionName }) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const modalRef = useRef(null);
  const [environments, setEnvironments] = useState([]);
  const [selectedEnv, setSelectedEnv] = useState(null);
  const [editingVars, setEditingVars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (collectionId) {
      loadEnvironments(true);
    }
  }, [collectionId]);

  const loadEnvironments = async (autoSelectFirst = false) => {
    if (!collectionId) return;
    setLoading(true);
    try {
      const envs = await data.getEnvironments(collectionId);
      setEnvironments(envs);
      // Auto-select first environment or active one on initial load
      if (autoSelectFirst && envs.length > 0) {
        const active = envs.find(e => e.is_active);
        const envToSelect = active || envs[0];
        setSelectedEnv(envToSelect);
        setEditingVars(envToSelect.variables.map(v => ({ ...v })));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectEnv = async (env) => {
    // Check for unsaved changes before switching
    if (hasUnsavedChanges) {
      const confirmed = await confirm({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Discard them?',
        confirmText: 'Discard',
        cancelText: 'Cancel',
        variant: 'danger',
      });
      if (!confirmed) return;
    }
    setSelectedEnv(env);
    setEditingVars(env.variables.map(v => ({ ...v })));
    setHasUnsavedChanges(false);
  };

  const handleAddVariable = () => {
    setEditingVars([...editingVars, { key: '', value: '', enabled: true }]);
    setHasUnsavedChanges(true);
  };

  const handleUpdateVariable = (index, field, value) => {
    const newVars = [...editingVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEditingVars(newVars);
    setHasUnsavedChanges(true);
  };

  const handleRemoveVariable = (index) => {
    setEditingVars(editingVars.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    if (!selectedEnv) return;
    setSaving(true);
    try {
      const filteredVars = editingVars.filter(v => v.key.trim());
      await data.updateEnvironment(selectedEnv.id, {
        name: selectedEnv.name,
        variables: filteredVars,
      });
      // Update local state instead of reloading
      setEnvironments(prev => prev.map(env =>
        env.id === selectedEnv.id
          ? { ...env, variables: filteredVars }
          : env
      ));
      setSelectedEnv(prev => ({ ...prev, variables: filteredVars }));
      setEditingVars(filteredVars);
      setHasUnsavedChanges(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateEnv = async () => {
    if (!collectionId) return;
    const name = await prompt({
      title: 'New Environment',
      message: 'Enter a name for the new environment:',
      defaultValue: 'New Environment',
      placeholder: 'Environment name',
    });
    if (name) {
      const env = await data.createEnvironment({ name, variables: [], collection_id: collectionId });
      setEnvironments(prev => [...prev, env]);
      setSelectedEnv(env);
      setEditingVars([]);
      setHasUnsavedChanges(false);
    }
  };

  const handleDeleteEnv = async (envId) => {
    const env = environments.find(e => e.id === envId);
    const confirmed = await confirm({
      title: 'Delete Environment',
      message: `Are you sure you want to delete "${env?.name || 'this environment'}"? This will affect all users.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      await data.deleteEnvironment(envId);
      setEnvironments(prev => prev.filter(e => e.id !== envId));
      if (selectedEnv?.id === envId) {
        const remaining = environments.filter(e => e.id !== envId);
        if (remaining.length > 0) {
          setSelectedEnv(remaining[0]);
          setEditingVars(remaining[0].variables.map(v => ({ ...v })));
        } else {
          setSelectedEnv(null);
          setEditingVars([]);
        }
      }
      setHasUnsavedChanges(false);
    }
  };

  const handleRenameEnv = async (envId) => {
    const env = envId ? environments.find(e => e.id === envId) : selectedEnv;
    if (!env) return;

    const name = await prompt({
      title: 'Rename Environment',
      message: 'Enter a new name for the environment:',
      defaultValue: env.name,
      placeholder: 'Environment name',
    });
    if (name && name !== env.name) {
      await data.updateEnvironment(env.id, { name });
      setEnvironments(prev => prev.map(e =>
        e.id === env.id ? { ...e, name } : e
      ));
      if (selectedEnv?.id === env.id) {
        setSelectedEnv(prev => ({ ...prev, name }));
      }
    }
  };

  const handleDuplicateEnv = async (envId) => {
    const env = environments.find(e => e.id === envId);
    if (!env || !collectionId) return;

    const newEnv = await data.createEnvironment({
      name: `${env.name} - copy`,
      variables: env.variables || [],
      collection_id: collectionId,
    });
    setEnvironments(prev => [...prev, newEnv]);
    setSelectedEnv(newEnv);
    setEditingVars(newEnv.variables?.map(v => ({ ...v })) || []);
    setHasUnsavedChanges(false);
  };

  const handleClose = async () => {
    if (hasUnsavedChanges) {
      const confirmed = await confirm({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Discard them?',
        confirmText: 'Discard',
        cancelText: 'Cancel',
        variant: 'danger',
      });
      if (!confirmed) return;
    }
    onClose();
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const getEnvMenuItems = (env) => [
    {
      icon: <Edit2 size={14} />,
      label: 'Rename',
      onClick: () => handleRenameEnv(env.id),
    },
    {
      icon: <Copy size={14} />,
      label: 'Duplicate',
      onClick: () => handleDuplicateEnv(env.id),
    },
    { type: 'divider' },
    {
      icon: <Trash2 size={14} />,
      label: 'Delete',
      variant: 'danger',
      onClick: () => handleDeleteEnv(env.id),
    },
  ];

  return (
    <div className="env-editor-overlay" onClick={handleOverlayClick}>
      <div className="env-editor" ref={modalRef}>
        <div className="env-editor-header">
          <h2>Manage Environments{collectionName ? ` - ${collectionName}` : ''}</h2>
          <button className="btn-icon" onClick={handleClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="env-editor-body">
          {!collectionId ? (
            <div className="env-no-collection">
              <p>Please select a request first to manage environments for its collection.</p>
            </div>
          ) : (
          <>
          <div className="env-list">
            <div className="env-list-header">
              <span>Environments</span>
              <button className="btn-icon small" onClick={handleCreateEnv} title="Add Environment">
                <Plus size={16} />
              </button>
            </div>
            {loading ? (
              <div className="env-loading">Loading...</div>
            ) : environments.length === 0 ? (
              <div className="env-empty">
                <p>No environments yet</p>
                <button className="btn-create-first" onClick={handleCreateEnv}>
                  Create Environment
                </button>
              </div>
            ) : (
              <div className="env-items">
                {environments.map(env => (
                  <div
                    key={env.id}
                    className={`env-item ${selectedEnv?.id === env.id ? 'selected' : ''}`}
                    onClick={() => handleSelectEnv(env)}
                  >
                    <div className="env-item-info">
                      <span className="env-name">{env.name}</span>
                      <span className="env-item-meta">
                        {env.variables?.length || 0} vars
                        {env.created_by_email && (
                          <span className="env-creator"> · {env.created_by_email}</span>
                        )}
                      </span>
                    </div>
                    <DropdownMenu items={getEnvMenuItems(env)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="env-variables">
            {selectedEnv ? (
              <>
                <div className="env-var-header">
                  <span className="env-var-title">{selectedEnv.name}</span>
                  <button className="btn-icon small" onClick={() => handleRenameEnv(selectedEnv?.id)} title="Rename">
                    <Edit2 size={14} />
                  </button>
                </div>
                <div className="env-var-table">
                  <table>
                    <thead>
                      <tr>
                        <th className="col-enabled"></th>
                        <th className="col-key">Variable</th>
                        <th className="col-value">Value</th>
                        <th className="col-actions"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editingVars.map((v, index) => (
                        <tr key={index} className={v.enabled === false ? 'disabled' : ''}>
                          <td className="col-enabled">
                            <input
                              type="checkbox"
                              checked={v.enabled !== false}
                              onChange={(e) => handleUpdateVariable(index, 'enabled', e.target.checked)}
                            />
                          </td>
                          <td className="col-key">
                            <input
                              type="text"
                              placeholder="Variable name"
                              value={v.key}
                              onChange={(e) => handleUpdateVariable(index, 'key', e.target.value)}
                            />
                          </td>
                          <td className="col-value">
                            <input
                              type="text"
                              placeholder="Value"
                              value={v.value}
                              onChange={(e) => handleUpdateVariable(index, 'value', e.target.value)}
                            />
                          </td>
                          <td className="col-actions">
                            <button
                              className="btn-icon small"
                              onClick={() => handleRemoveVariable(index)}
                              title="Remove"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {editingVars.length === 0 && (
                        <tr className="empty-row">
                          <td colSpan="4">No variables yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <button className="btn-add-var" onClick={handleAddVariable}>
                    <Plus size={14} />
                    Add Variable
                  </button>
                </div>
                <div className="env-var-footer">
                  <button
                    className="btn-save"
                    onClick={handleSave}
                    disabled={saving || !hasUnsavedChanges}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </>
            ) : (
              <div className="env-var-empty">
                {environments.length > 0
                  ? 'Select an environment to edit variables'
                  : 'Create an environment to get started'
                }
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
