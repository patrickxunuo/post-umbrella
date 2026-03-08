import { useState, useEffect } from 'react';
import {
  X,
  Users,
  Settings,
  Trash2,
  UserPlus,
  AlertTriangle,
  Crown,
  Code,
  Eye,
  MoreVertical,
} from 'lucide-react';

export function WorkspaceSettings({
  workspace,
  members,
  onClose,
  onUpdateWorkspace,
  onAddMember,
  onRemoveMember,
  onDeleteWorkspace,
  currentUserId,
  isAdmin,
}) {
  const [activeTab, setActiveTab] = useState('general');
  const [workspaceName, setWorkspaceName] = useState(workspace?.name || '');
  const [workspaceDescription, setWorkspaceDescription] = useState(workspace?.description || '');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [showMemberDropdown, setShowMemberDropdown] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [saving, setSaving] = useState(false);
  const [addingMember, setAddingMember] = useState(false);

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

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberEmail.trim()) return;
    setAddingMember(true);
    try {
      await onAddMember(workspace.id, newMemberEmail.trim());
      setNewMemberEmail('');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId) => {
    await onRemoveMember(workspace.id, userId);
  };

  const handleDeleteWorkspace = async () => {
    if (deleteConfirmText !== workspace.name) return;
    await onDeleteWorkspace(workspace.id);
    onClose();
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'admin': return <Crown size={12} />;
      case 'developer': return <Code size={12} />;
      case 'reader': return <Eye size={12} />;
      default: return null;
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'admin': return 'Admin';
      case 'developer': return 'Developer';
      case 'reader': return 'Reader';
      default: return role;
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'members', label: 'Members', icon: Users, count: members?.length },
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

            {activeTab === 'members' && (
              <div className="settings-section">
                {isAdmin && (
                  <>
                    <div className="section-title">Add Existing User</div>
                    <form className="add-member-form" onSubmit={handleAddMember}>
                      <input
                        type="email"
                        value={newMemberEmail}
                        onChange={e => setNewMemberEmail(e.target.value)}
                        placeholder="Email address of existing user"
                        required
                      />
                      <button
                        type="submit"
                        className="btn-primary"
                        disabled={addingMember || !newMemberEmail.trim()}
                      >
                        <UserPlus size={14} />
                        {addingMember ? 'Adding...' : 'Add'}
                      </button>
                    </form>
                    <p className="add-member-hint">
                      Only existing users can be added. Use User Management to invite new users.
                    </p>
                  </>
                )}

                <div className="section-title" style={{ marginTop: isAdmin ? '24px' : 0 }}>
                  Members ({members?.length || 0})
                </div>
                <div className="members-list">
                  {members?.map(member => (
                    <div key={member.user_id} className="member-item">
                      <div className="member-avatar">
                        {(member.email || 'U')[0].toUpperCase()}
                      </div>
                      <div className="member-info">
                        <div className="member-email">{member.email || 'Unknown'}</div>
                        <div className={`member-role role-${member.role}`}>
                          {getRoleIcon(member.role)}
                          {getRoleLabel(member.role)}
                        </div>
                      </div>
                      {isAdmin && member.user_id !== currentUserId && (
                        <div className="member-actions">
                          <div className="member-dropdown-container">
                            <button
                              className="btn-icon"
                              onClick={() => setShowMemberDropdown(
                                showMemberDropdown === member.user_id ? null : member.user_id
                              )}
                            >
                              <MoreVertical size={16} />
                            </button>
                            {showMemberDropdown === member.user_id && (
                              <div className="member-dropdown">
                                <button
                                  className="dropdown-item danger"
                                  onClick={() => {
                                    handleRemoveMember(member.user_id);
                                    setShowMemberDropdown(null);
                                  }}
                                >
                                  <Trash2 size={14} />
                                  Remove from Workspace
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {member.user_id === currentUserId && (
                        <span className="you-badge">You</span>
                      )}
                    </div>
                  ))}
                </div>
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
