import { useState, useEffect } from 'react';
import {
  X,
  Crown,
  Code,
  Eye,
  Check,
  CheckCircle,
  Ban,
  Briefcase,
} from 'lucide-react';
import { getInitials, getAvatarColor } from './WorkspacePresenceAvatars';

export function EditUserModal({
  user,
  allWorkspaces = [],
  currentUserId,
  onSave,
  onClose,
  saving = false,
  isSystem = false,
  canEditRoles = true,
}) {
  const [role, setRole] = useState(user?.role || 'reader');
  const [status, setStatus] = useState(user?.status || 'pending');
  const [workspaces, setWorkspaces] = useState(user?.workspaces?.map(w => w.id) || []);

  // Reset state when user changes
  useEffect(() => {
    if (user) {
      setRole(user.role);
      setStatus(user.status);
      setWorkspaces(user.workspaces?.map(w => w.id) || []);
    }
  }, [user]);

  const toggleWorkspace = (wsId) => {
    setWorkspaces(prev =>
      prev.includes(wsId)
        ? prev.filter(id => id !== wsId)
        : [...prev, wsId]
    );
  };

  const handleSave = () => {
    onSave({
      role,
      status,
      workspaces,
    });
  };

  const isEditingSelf = user?.user_id === currentUserId;
  const isEditingOwnAdminRole = isEditingSelf && user?.role === 'admin';

  // Check if there are changes
  const hasChanges = () => {
    if (role !== user?.role) return true;
    if (status !== user?.status) return true;
    const currentWsIds = user?.workspaces?.map(w => w.id) || [];
    if (workspaces.length !== currentWsIds.length) return true;
    return !workspaces.every(id => currentWsIds.includes(id));
  };

  // Note: 'system' role can only be assigned via direct database update
  const roles = [
    { id: 'admin', label: 'Admin', icon: Crown },
    { id: 'developer', label: 'Developer', icon: Code },
    { id: 'reader', label: 'Reader', icon: Eye },
  ];

  const statuses = [
    { id: 'active', label: 'Active', icon: CheckCircle, color: 'success' },
    { id: 'disabled', label: 'Disabled', icon: Ban, color: 'danger' },
  ];

  if (!user) return null;

  return (
    <div className="edit-user-overlay" onClick={onClose}>
      <div className="edit-user-modal compact" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="edit-modal-header compact">
          <div className="edit-header-content">
            <div
              className="edit-user-avatar small"
              style={{ '--avatar-color': getAvatarColor(user.email) }}
            >
              {getInitials(user.email)}
            </div>
            <div className="edit-header-info">
              <h3>{user.email}</h3>
              <span className="edit-user-id">ID: {user.user_id?.slice(0, 8)}...</span>
            </div>
          </div>
          <button className="edit-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Form Content */}
        <div className="edit-modal-content compact">
          {/* Role Selection */}
          <div className="edit-field-group">
            <label className="edit-field-label">Role</label>
            <div className="edit-role-inline">
              {roles.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className={`edit-role-btn role-${r.id} ${role === r.id ? 'selected' : ''}`}
                  onClick={() => setRole(r.id)}
                  disabled={!canEditRoles || (isEditingOwnAdminRole && r.id !== 'admin')}
                  title={!canEditRoles ? 'Only system users can edit roles' : isEditingOwnAdminRole && r.id !== 'admin' ? 'You cannot downgrade your own admin role' : r.label}
                >
                  <r.icon size={14} />
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Status Selection - System only */}
          {isSystem && (
            <div className="edit-field-group">
              <label className="edit-field-label">Status</label>
              <div className="edit-status-inline">
                {statuses.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`edit-status-btn status-${s.color} ${status === s.id ? 'selected' : ''}`}
                    onClick={() => setStatus(s.id)}
                    disabled={isEditingSelf && s.id === 'disabled'}
                    title={isEditingSelf && s.id === 'disabled' ? 'You cannot disable your own account' : s.label}
                  >
                    <s.icon size={14} />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Workspace Access - System only */}
          {isSystem && (
            <div className="edit-field-group">
              <label className="edit-field-label">
                Workspaces
                <span className="edit-field-count">{workspaces.length} selected</span>
              </label>
              <div className="edit-workspace-grid">
                {allWorkspaces.filter(ws => ws.id !== '00000000-0000-0000-0000-000000000001').length === 0 ? (
                  <div className="edit-workspace-empty">
                    <Briefcase size={16} />
                    <span>No workspaces available</span>
                  </div>
                ) : (
                  allWorkspaces
                    .filter(ws => ws.id !== '00000000-0000-0000-0000-000000000001')
                    .map(ws => (
                      <label key={ws.id} className="edit-workspace-chip">
                        <input
                          type="checkbox"
                          checked={workspaces.includes(ws.id)}
                          onChange={() => toggleWorkspace(ws.id)}
                        />
                        <span className="chip-content">
                          {workspaces.includes(ws.id) && <Check size={12} />}
                          {ws.name}
                        </span>
                      </label>
                    ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="edit-modal-footer compact">
          <button
            type="button"
            className="edit-btn-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="edit-btn-save"
            onClick={handleSave}
            disabled={saving || !hasChanges()}
          >
            {saving ? (
              <>
                <span className="edit-btn-spinner" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
