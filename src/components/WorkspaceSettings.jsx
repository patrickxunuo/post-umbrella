import { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

export function WorkspaceSettings({
  workspace,
  onClose,
  onUpdateWorkspace,
  onDeleteWorkspace,
  isAdmin,
}) {
  const [activeTab, setActiveTab] = useState('general');
  const [workspaceName, setWorkspaceName] = useState(workspace?.name || '');
  const [workspaceDescription, setWorkspaceDescription] = useState(workspace?.description || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWorkspaceName(workspace?.name || '');
    setWorkspaceDescription(workspace?.description || '');
  }, [workspace]);

  const handleSaveGeneral = async () => {
    if (!workspaceName.trim()) return;
    setSaving(true);
    try {
      await onUpdateWorkspace(workspace.id, {
        name: workspaceName.trim(),
        description: workspaceDescription.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (deleteConfirmText !== workspace.name) return;
    await onDeleteWorkspace(workspace.id);
    onClose();
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
  ];

  return (
    <div className="workspace-settings-overlay" onClick={onClose}>
      <div className="workspace-settings" onClick={e => e.stopPropagation()}>
        <div className="workspace-settings-header">
          <h2>Workspace Settings</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="workspace-settings-body">
          <div className="workspace-settings-tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`workspace-tab ${activeTab === tab.id ? 'active' : ''} ${tab.id === 'danger' ? 'danger' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon size={16} />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="tab-count">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className="workspace-settings-content">
            {activeTab === 'general' && (
              <div className="settings-section">
                <div className="section-title">Workspace Details</div>
                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={e => setWorkspaceName(e.target.value)}
                    placeholder="Workspace name"
                    disabled={!isAdmin}
                  />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={workspaceDescription}
                    onChange={e => setWorkspaceDescription(e.target.value)}
                    placeholder="Optional description..."
                    rows={3}
                    disabled={!isAdmin}
                  />
                </div>
                {isAdmin && (
                  <button
                    className="btn-primary"
                    onClick={handleSaveGeneral}
                    disabled={saving || !workspaceName.trim()}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
              </div>
            )}

            {activeTab === 'danger' && (
              <div className="settings-section danger-zone">
                <div className="danger-card">
                  <div className="danger-header">
                    <AlertTriangle size={20} />
                    <div>
                      <h3>Delete Workspace</h3>
                      <p>
                        This action cannot be undone. All members will lose access to this workspace.
                        Collections will NOT be deleted, but will be unlinked.
                      </p>
                    </div>
                  </div>
                  {isAdmin ? (
                    <>
                      {!showDeleteConfirm ? (
                        <button
                          className="btn-danger"
                          onClick={() => setShowDeleteConfirm(true)}
                        >
                          <Trash2 size={14} />
                          Delete this workspace
                        </button>
                      ) : (
                        <div className="delete-confirm">
                          <p>Type <strong>{workspace.name}</strong> to confirm:</p>
                          <input
                            type="text"
                            value={deleteConfirmText}
                            onChange={e => setDeleteConfirmText(e.target.value)}
                            placeholder="Enter workspace name"
                            autoFocus
                          />
                          <div className="confirm-actions">
                            <button
                              className="btn-secondary"
                              onClick={() => {
                                setShowDeleteConfirm(false);
                                setDeleteConfirmText('');
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn-danger"
                              onClick={handleDeleteWorkspace}
                              disabled={deleteConfirmText !== workspace.name}
                            >
                              Delete Forever
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="no-permission">Only workspace admins can delete the workspace.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
