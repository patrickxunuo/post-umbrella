import { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  Crown,
  Code,
  Eye,
  MoreVertical,
  Check,
  ChevronDown,
  Users,
  Shield,
  Mail,
  Clock,
  Ban,
  CheckCircle,
  AlertCircle,
  Briefcase,
  Settings,
  Search,
} from 'lucide-react';

// Optional email domain restriction from env
const EMAIL_DOMAIN = import.meta.env.VITE_EMAIL_DOMAIN || '';

export function UserManagement({
  users = [],
  allWorkspaces = [],
  onClose,
  onInviteUser,
  onUpdateUser,
  onUpdateUserWorkspaces,
}) {
  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('developer');
  const [inviteWorkspaces, setInviteWorkspaces] = useState([]);
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [inviting, setInviting] = useState(false);

  // User list state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDropdown, setActiveDropdown] = useState(null);

  // Edit modal state
  const [editingUser, setEditingUser] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editWorkspaces, setEditWorkspaces] = useState([]);
  const [saving, setSaving] = useState(false);

  // Filter users based on search
  const filteredUsers = users.filter(user =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Validate email domain if restriction is set
  const isEmailValid = (emailAddr) => {
    if (!EMAIL_DOMAIN) return true;
    return emailAddr.endsWith(EMAIL_DOMAIN);
  };

  // Handle invite submission
  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    // Validate email domain
    if (!isEmailValid(inviteEmail.trim())) {
      alert(`Only ${EMAIL_DOMAIN} emails are allowed`);
      return;
    }

    setInviting(true);
    try {
      await onInviteUser(inviteEmail.trim(), inviteRole, inviteWorkspaces);
      setInviteEmail('');
      setInviteRole('developer');
      setInviteWorkspaces([]);
    } finally {
      setInviting(false);
    }
  };

  // Toggle workspace in invite selection
  const toggleInviteWorkspace = (wsId) => {
    setInviteWorkspaces(prev =>
      prev.includes(wsId)
        ? prev.filter(id => id !== wsId)
        : [...prev, wsId]
    );
  };

  // Open edit modal for a user
  const openEditModal = (user) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditStatus(user.status);
    setEditWorkspaces(user.workspaces?.map(w => w.id) || []);
    setActiveDropdown(null);
  };

  // Save user changes
  const handleSaveUser = async () => {
    if (!editingUser) return;

    setSaving(true);
    try {
      // Update role and status if changed
      if (editRole !== editingUser.role || editStatus !== editingUser.status) {
        await onUpdateUser(editingUser.user_id, {
          role: editRole,
          status: editStatus,
        });
      }

      // Update workspaces if changed
      const currentWsIds = editingUser.workspaces?.map(w => w.id) || [];
      const wsChanged = editWorkspaces.length !== currentWsIds.length ||
        !editWorkspaces.every(id => currentWsIds.includes(id));

      if (wsChanged) {
        await onUpdateUserWorkspaces(editingUser.user_id, editWorkspaces);
      }

      setEditingUser(null);
    } finally {
      setSaving(false);
    }
  };

  // Toggle workspace in edit selection
  const toggleEditWorkspace = (wsId) => {
    setEditWorkspaces(prev =>
      prev.includes(wsId)
        ? prev.filter(id => id !== wsId)
        : [...prev, wsId]
    );
  };

  // Role helpers
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

  // Status helpers
  const getStatusIcon = (status) => {
    switch (status) {
      case 'active': return <CheckCircle size={12} />;
      case 'pending': return <Clock size={12} />;
      case 'disabled': return <Ban size={12} />;
      default: return <AlertCircle size={12} />;
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'active': return 'Active';
      case 'pending': return 'Pending';
      case 'disabled': return 'Disabled';
      default: return status;
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.user-actions-dropdown') && !e.target.closest('.btn-icon')) {
        setActiveDropdown(null);
      }
      if (!e.target.closest('.workspace-multiselect')) {
        setShowWorkspaceDropdown(false);
      }
      if (!e.target.closest('.role-dropdown')) {
        setShowRoleDropdown(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <div className="user-management-overlay" onClick={onClose}>
      <div className="user-management" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="user-management-header">
          <div className="header-title">
            <Shield size={20} />
            <h2>User Management</h2>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="user-management-body">
          {/* Invite User Section */}
          <div className="invite-section">
            <div className="section-label">
              <UserPlus size={14} />
              Invite New User
            </div>
            <form className="invite-form" onSubmit={handleInvite}>
              <div className="invite-row">
                <div className="invite-email">
                  <Mail size={14} className="input-icon" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder={EMAIL_DOMAIN ? `user${EMAIL_DOMAIN}` : 'user@example.com'}
                    required
                  />
                </div>

                <div className="role-dropdown">
                  <button
                    type="button"
                    className="role-dropdown-trigger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRoleDropdown(!showRoleDropdown);
                    }}
                  >
                    <span className={`role-badge role-${inviteRole}`}>
                      {getRoleIcon(inviteRole)}
                      {getRoleLabel(inviteRole)}
                    </span>
                    <ChevronDown size={14} className={`dropdown-chevron ${showRoleDropdown ? 'open' : ''}`} />
                  </button>
                  {showRoleDropdown && (
                    <div className="role-dropdown-menu">
                      {['reader', 'developer', 'admin'].map(role => (
                        <button
                          key={role}
                          type="button"
                          className={`role-dropdown-item ${inviteRole === role ? 'selected' : ''}`}
                          onClick={() => {
                            setInviteRole(role);
                            setShowRoleDropdown(false);
                          }}
                        >
                          {getRoleIcon(role)}
                          <span>{getRoleLabel(role)}</span>
                          {inviteRole === role && <Check size={14} className="check-icon" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="workspace-multiselect">
                  <button
                    type="button"
                    className="workspace-select-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowWorkspaceDropdown(!showWorkspaceDropdown);
                    }}
                  >
                    <Briefcase size={14} />
                    <span>
                      {inviteWorkspaces.length === 0
                        ? 'Select Workspaces'
                        : `${inviteWorkspaces.length} workspace${inviteWorkspaces.length > 1 ? 's' : ''}`}
                    </span>
                    <ChevronDown size={14} />
                  </button>

                  {showWorkspaceDropdown && (
                    <div className="workspace-dropdown">
                      {allWorkspaces.length === 0 ? (
                        <div className="empty-workspaces">No workspaces available</div>
                      ) : (
                        allWorkspaces.map(ws => (
                          <label key={ws.id} className="workspace-checkbox">
                            <input
                              type="checkbox"
                              checked={inviteWorkspaces.includes(ws.id)}
                              onChange={() => toggleInviteWorkspace(ws.id)}
                            />
                            <span className="checkbox-mark">
                              {inviteWorkspaces.includes(ws.id) && <Check size={10} />}
                            </span>
                            <span className="workspace-name">{ws.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn-primary invite-btn"
                  disabled={inviting || !inviteEmail.trim()}
                >
                  <UserPlus size={14} />
                  {inviting ? 'Inviting...' : 'Invite'}
                </button>
              </div>
            </form>
          </div>

          {/* Users List Section */}
          <div className="users-section">
            <div className="users-header">
              <div className="section-label">
                <Users size={14} />
                Users ({users.length})
              </div>
              <div className="search-box">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="users-table">
              <div className="table-header">
                <div className="col-email">Email</div>
                <div className="col-role">Role</div>
                <div className="col-status">Status</div>
                <div className="col-workspaces">Workspaces</div>
                <div className="col-actions"></div>
              </div>

              <div className="table-body">
                {filteredUsers.length === 0 ? (
                  <div className="empty-users">
                    <Users size={32} />
                    <p>{searchQuery ? 'No users match your search' : 'No users yet'}</p>
                  </div>
                ) : (
                  filteredUsers.map(user => (
                    <div key={user.user_id} className="user-row">
                      <div className="col-email">
                        <span className="user-avatar">
                          {(user.email || 'U')[0].toUpperCase()}
                        </span>
                        <span className="user-email">{user.email}</span>
                      </div>

                      <div className="col-role">
                        <span className={`role-badge role-${user.role}`}>
                          {getRoleIcon(user.role)}
                          {getRoleLabel(user.role)}
                        </span>
                      </div>

                      <div className="col-status">
                        <span className={`status-badge status-${user.status}`}>
                          {getStatusIcon(user.status)}
                          {getStatusLabel(user.status)}
                        </span>
                      </div>

                      <div className="col-workspaces">
                        <span className="workspace-count">
                          <Briefcase size={12} />
                          {user.workspaces?.length || 0}
                        </span>
                      </div>

                      <div className="col-actions">
                        <button
                          className="btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDropdown(activeDropdown === user.user_id ? null : user.user_id);
                          }}
                        >
                          <MoreVertical size={16} />
                        </button>

                        {activeDropdown === user.user_id && (
                          <div className="user-actions-dropdown">
                            <button onClick={() => openEditModal(user)}>
                              <Settings size={14} />
                              Edit User
                            </button>
                            {user.status === 'disabled' ? (
                              <button
                                onClick={() => {
                                  onUpdateUser(user.user_id, { status: 'active' });
                                  setActiveDropdown(null);
                                }}
                              >
                                <CheckCircle size={14} />
                                Enable User
                              </button>
                            ) : (
                              <button
                                className="danger"
                                onClick={() => {
                                  onUpdateUser(user.user_id, { status: 'disabled' });
                                  setActiveDropdown(null);
                                }}
                              >
                                <Ban size={14} />
                                Disable User
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Edit User Modal */}
        {editingUser && (
          <div className="edit-user-overlay" onClick={() => setEditingUser(null)}>
            <div className="edit-user-modal" onClick={e => e.stopPropagation()}>
              <div className="edit-modal-header">
                <h3>Edit User</h3>
                <button className="modal-close" onClick={() => setEditingUser(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="edit-modal-body">
                <div className="edit-user-info">
                  <span className="edit-avatar">
                    {(editingUser.email || 'U')[0].toUpperCase()}
                  </span>
                  <span className="edit-email">{editingUser.email}</span>
                </div>

                <div className="edit-field">
                  <label>Role</label>
                  <div className="role-options">
                    {['reader', 'developer', 'admin'].map(role => (
                      <button
                        key={role}
                        className={`role-option ${editRole === role ? 'selected' : ''}`}
                        onClick={() => setEditRole(role)}
                      >
                        {getRoleIcon(role)}
                        {getRoleLabel(role)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="edit-field">
                  <label>Status</label>
                  <div className="status-options">
                    {['active', 'pending', 'disabled'].map(status => (
                      <button
                        key={status}
                        className={`status-option status-${status} ${editStatus === status ? 'selected' : ''}`}
                        onClick={() => setEditStatus(status)}
                        disabled={status === 'pending' && editingUser.status !== 'pending'}
                      >
                        {getStatusIcon(status)}
                        {getStatusLabel(status)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="edit-field">
                  <label>Workspace Access</label>
                  <div className="edit-workspaces">
                    {allWorkspaces.length === 0 ? (
                      <div className="empty-workspaces">No workspaces available</div>
                    ) : (
                      allWorkspaces.map(ws => (
                        <label key={ws.id} className="workspace-checkbox">
                          <input
                            type="checkbox"
                            checked={editWorkspaces.includes(ws.id)}
                            onChange={() => toggleEditWorkspace(ws.id)}
                          />
                          <span className="checkbox-mark">
                            {editWorkspaces.includes(ws.id) && <Check size={10} />}
                          </span>
                          <span className="workspace-name">{ws.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="edit-modal-footer">
                <button
                  className="btn-secondary"
                  onClick={() => setEditingUser(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSaveUser}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
