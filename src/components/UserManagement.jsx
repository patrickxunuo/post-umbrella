import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Trash2,
} from 'lucide-react';
import { useConfirm } from './ConfirmModal';
import { useToast } from './Toast';
import { EditUserModal } from './EditUserModal';
import { getInitials, getAvatarColor } from './WorkspacePresenceAvatars';

// Optional email domain restriction from env
const EMAIL_DOMAIN = import.meta.env.VITE_EMAIL_DOMAIN || '';

export function UserManagement({
  users = [],
  allWorkspaces = [],
  activeWorkspace,
  currentUserId,
  userRole = 'developer',
  onClose,
  onInviteUser,
  onUpdateUser,
  onUpdateUserWorkspaces,
  onDeleteUser,
  loading = false,
  isSystem = false,
}) {
  const toast = useToast();
  const confirm = useConfirm();

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
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  // Edit modal state
  const [editingUser, setEditingUser] = useState(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation state (for system users)
  const [deletingUser, setDeletingUser] = useState(null);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');

  // Refs for dropdown click-outside detection
  const roleDropdownRef = useRef(null);
  const workspaceDropdownRef = useRef(null);

  // Role priority for sorting (higher = first, system treated as admin)
  const rolePriority = { system: 3, admin: 3, developer: 2, reader: 1 };

  // Filter users: system sees all, admin sees only current workspace members
  const workspaceFilteredUsers = isSystem
    ? users
    : users.filter(user =>
        user.workspaces?.some(ws => ws.id === activeWorkspace?.id)
      );

  // Filter by search and sort: logged-in user first, then by role, then alphabetically
  const filteredUsers = workspaceFilteredUsers
    .filter(user => user.email?.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      // Logged-in user always first
      if (a.user_id === currentUserId) return -1;
      if (b.user_id === currentUserId) return 1;
      // Then sort by role priority (system > admin > developer > reader)
      const roleDiff = (rolePriority[b.role] || 0) - (rolePriority[a.role] || 0);
      if (roleDiff !== 0) return roleDiff;
      // Then sort alphabetically by email
      return (a.email || '').localeCompare(b.email || '');
    });

  // Get display role (system users appear as "admin" to non-system users)
  const getDisplayRole = (role) => {
    if (role === 'system' && !isSystem) return 'admin';
    return role;
  };

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
      toast.warning(`Only ${EMAIL_DOMAIN} emails are allowed`);
      return;
    }

    // System can choose workspaces, others auto-invite to current workspace
    const workspacesToInvite = isSystem
      ? inviteWorkspaces
      : activeWorkspace?.id ? [activeWorkspace.id] : [];

    if (workspacesToInvite.length === 0) {
      toast.warning('No workspace selected');
      return;
    }

    setInviting(true);
    try {
      await onInviteUser(inviteEmail.trim(), inviteRole, workspacesToInvite);
      setInviteEmail('');
      setInviteRole('developer');
      setInviteWorkspaces([]);
      setShowRoleDropdown(false);
      setShowWorkspaceDropdown(false);
    } catch {
      // Keep the form state intact so the admin can retry or adjust values.
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
    setActiveDropdown(null);
  };

  // Save user changes from EditUserModal
  const handleSaveUser = async ({ role, status, workspaces }) => {
    if (!editingUser) return;
    // Prevent assigning system role via UI
    if (role === 'system') {
      toast.error('System role can only be assigned via database');
      return;
    }
    // Admin cannot edit system users
    if (userRole === 'admin' && editingUser.role === 'system') {
      toast.error('You cannot edit system users');
      return;
    }
    if (editingUser.user_id === currentUserId && editingUser.role === 'admin' && role !== 'admin') {
      toast.error('You cannot downgrade your own admin role');
      return;
    }
    if (editingUser.user_id === currentUserId && status === 'disabled') {
      toast.error('You cannot disable your own account');
      return;
    }

    setSaving(true);
    try {
      // Update role and status if changed
      if (role !== editingUser.role || status !== editingUser.status) {
        await onUpdateUser(editingUser.user_id, { role, status });
      }

      // Update workspaces if changed
      const currentWsIds = editingUser.workspaces?.map(w => w.id) || [];
      const wsChanged = workspaces.length !== currentWsIds.length ||
        !workspaces.every(id => currentWsIds.includes(id));

      if (wsChanged) {
        await onUpdateUserWorkspaces(editingUser.user_id, workspaces);
      }

      setEditingUser(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!user || !onDeleteUser) return;
    if (user.user_id === currentUserId) {
      toast.error('You cannot delete your own account');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete User',
      message: `Delete ${user.email}? This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await onDeleteUser(user.user_id);
      setActiveDropdown(null);
    } catch {
      // Toast is handled by the parent callback.
    }
  };

  // Remove user from current workspace (for admin)
  const handleRemoveFromWorkspace = async (user) => {
    if (!user || !activeWorkspace) return;
    if (user.user_id === currentUserId) {
      toast.error('You cannot remove yourself from the workspace');
      return;
    }

    const confirmed = await confirm({
      title: 'Remove from Workspace',
      message: `Remove ${user.email} from ${activeWorkspace.name}?`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      // Get user's current workspaces minus the active one
      const currentWsIds = user.workspaces?.map(w => w.id) || [];
      const newWsIds = currentWsIds.filter(id => id !== activeWorkspace.id);
      await onUpdateUserWorkspaces(user.user_id, newWsIds);
      setActiveDropdown(null);
    } catch {
      // Toast is handled by the parent callback.
    }
  };

  // Role helpers
  const getRoleIcon = (role) => {
    switch (role) {
      case 'system': return <Shield size={12} />;
      case 'admin': return <Crown size={12} />;
      case 'developer': return <Code size={12} />;
      case 'reader': return <Eye size={12} />;
      default: return null;
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'system': return 'System';
      case 'admin': return 'Admin';
      case 'developer': return 'Developer';
      case 'reader': return 'Reader';
      default: return role;
    }
  };

  // Get available roles for invite based on current user's role
  // Note: 'system' role can only be assigned via direct database update
  const getInvitableRoles = () => {
    switch (userRole) {
      case 'system': return ['admin', 'developer', 'reader'];
      case 'admin': return ['admin', 'developer', 'reader'];
      case 'developer': return ['developer', 'reader'];
      default: return [];
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

  // Close role dropdown when clicking outside
  useEffect(() => {
    if (!showRoleDropdown) return;
    const handleClickOutside = (e) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target)) {
        setShowRoleDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRoleDropdown]);

  // Close workspace dropdown when clicking outside
  useEffect(() => {
    if (!showWorkspaceDropdown) return;
    const handleClickOutside = (e) => {
      if (workspaceDropdownRef.current && !workspaceDropdownRef.current.contains(e.target)) {
        setShowWorkspaceDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showWorkspaceDropdown]);

  // Close user actions dropdown when clicking outside
  useEffect(() => {
    if (!activeDropdown) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('.user-actions-dropdown') && !e.target.closest('.btn-icon')) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown]);

  const isInviteOnly = userRole === 'developer';
  const isAdminView = userRole === 'admin';

  return (
    <div className="user-management-overlay" onClick={onClose}>
      <div className={`user-management ${isInviteOnly ? 'invite-only' : ''} ${isAdminView ? 'admin-view' : ''}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="user-management-header">
          <div className="header-title">
            {isSystem ? <Shield size={20} /> : <UserPlus size={20} />}
            <h2>{isSystem ? 'User Management' : 'Invite Users'}</h2>
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

                <div className="role-dropdown" ref={roleDropdownRef}>
                  <button
                    type="button"
                    className="role-dropdown-trigger"
                    onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                  >
                    <span className={`role-badge role-${inviteRole}`}>
                      {getRoleIcon(inviteRole)}
                      {getRoleLabel(inviteRole)}
                    </span>
                    <ChevronDown size={14} className={`dropdown-chevron ${showRoleDropdown ? 'open' : ''}`} />
                  </button>
                  {showRoleDropdown && (
                    <div className="role-dropdown-menu">
                      {getInvitableRoles().map(role => (
                        <button
                          key={role}
                          type="button"
                          className={`role-dropdown-item role-${role} ${inviteRole === role ? 'selected' : ''}`}
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

                {isSystem && (
                  <div className="workspace-multiselect" ref={workspaceDropdownRef}>
                    <button
                      type="button"
                      className="workspace-select-btn"
                      onClick={() => setShowWorkspaceDropdown(!showWorkspaceDropdown)}
                    >
                      <Briefcase size={14} />
                      <span>
                        {inviteWorkspaces.length === 0
                          ? 'Select Workspaces'
                          : `${inviteWorkspaces.length} workspace${inviteWorkspaces.length > 1 ? 's' : ''}`}
                      </span>
                      <ChevronDown size={14} className={`dropdown-chevron ${showWorkspaceDropdown ? 'open' : ''}`} />
                    </button>

                    {showWorkspaceDropdown && (
                      <div className="workspace-dropdown">
                        {allWorkspaces.filter(ws => ws.id !== '00000000-0000-0000-0000-000000000001').length === 0 ? (
                          <div className="empty-workspaces">No workspaces available</div>
                        ) : (
                          allWorkspaces
                            .filter(ws => ws.id !== '00000000-0000-0000-0000-000000000001')
                            .map(ws => (
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
                )}

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

          {/* Users List Section - only for system and admin */}
          {['system', 'admin'].includes(userRole) && (
          <div className="users-section">
            <div className="users-header">
              <div className="section-label">
                <Users size={14} />
                {isSystem
                  ? `Users (${users.length})`
                  : `Users in ${activeWorkspace?.name || 'Workspace'} (${workspaceFilteredUsers.length})`}
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

            <div className={`users-table ${!isSystem ? 'no-workspace-col' : ''}`}>
              <div className="table-header">
                <div className="col-email">Email</div>
                <div className="col-role">Role</div>
                <div className="col-status">Status</div>
                {isSystem && <div className="col-workspaces">Workspaces</div>}
                <div className="col-actions"></div>
              </div>

              <div className="table-body">
                {loading ? (
                  <div className="loading-container">
                    <div className="loading-spinner medium" />
                    <span className="loading-text">Loading users...</span>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="empty-users">
                    <Users size={32} />
                    <p>{searchQuery ? 'No users match your search' : 'No users yet'}</p>
                  </div>
                ) : (
                  filteredUsers.map(user => {
                    const isSelf = user.user_id === currentUserId;
                    return (
                    <div key={user.user_id} className="user-row">
                      <div className="col-email">
                        <span
                          className="user-avatar"
                          style={{ '--avatar-color': getAvatarColor(user.email) }}
                        >
                          {getInitials(user.email)}
                        </span>
                        <span className="user-email">
                          {user.email}
                          {isSelf && <span className="you-badge">You</span>}
                        </span>
                      </div>

                      <div className="col-role">
                        <span className={`role-badge role-${getDisplayRole(user.role)}`}>
                          {getRoleIcon(getDisplayRole(user.role))}
                          {getRoleLabel(getDisplayRole(user.role))}
                        </span>
                      </div>

                      <div className="col-status">
                        <span className={`status-badge status-${user.status}`}>
                          {getStatusIcon(user.status)}
                          {getStatusLabel(user.status)}
                        </span>
                      </div>

                      {isSystem && (
                        <div className="col-workspaces">
                          <span className="workspace-count">
                            <Briefcase size={12} />
                            {user.workspaces?.length || 0}
                          </span>
                        </div>
                      )}

                      <div className="col-actions">
                        {/* Hide dropdown for: self, or system users when current user is admin */}
                        {!isSelf && (isSystem || user.role !== 'system') && (
                          <button
                            className="btn-icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (activeDropdown === user.user_id) {
                                setActiveDropdown(null);
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setDropdownPosition({
                                  top: rect.bottom + 4,
                                  left: rect.right - 140,
                                });
                                setActiveDropdown(user.user_id);
                              }
                            }}
                          >
                            <MoreVertical size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Edit User Modal */}
        {editingUser && (
          <EditUserModal
            user={editingUser}
            allWorkspaces={allWorkspaces}
            currentUserId={currentUserId}
            onSave={handleSaveUser}
            onClose={() => setEditingUser(null)}
            saving={saving}
            isSystem={isSystem}
            canEditRoles={isSystem || (userRole === 'admin' && editingUser?.role !== 'system')}
          />
        )}

        {/* Delete Confirmation Modal (System only) */}
        {deletingUser && (
          <div className="delete-user-overlay" onClick={() => setDeletingUser(null)}>
            <div className="delete-user-modal" onClick={e => e.stopPropagation()}>
              <div className="delete-user-header">
                <AlertCircle size={20} />
                <h3>Delete User</h3>
              </div>
              <div className="delete-user-body">
                <p>
                  This will permanently delete <strong>{deletingUser.email}</strong> and remove them from all workspaces.
                </p>
                <p className="delete-user-warning">This action cannot be undone.</p>
                <div className="delete-user-confirm">
                  <label>Type the email to confirm:</label>
                  <input
                    type="text"
                    value={deleteConfirmEmail}
                    onChange={e => setDeleteConfirmEmail(e.target.value)}
                    placeholder={deletingUser.email}
                    autoFocus
                  />
                </div>
              </div>
              <div className="delete-user-footer">
                <button
                  className="btn-secondary"
                  onClick={() => setDeletingUser(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-danger"
                  disabled={deleteConfirmEmail !== deletingUser.email}
                  onClick={async () => {
                    try {
                      await onDeleteUser(deletingUser.user_id);
                      setDeletingUser(null);
                      setDeleteConfirmEmail('');
                    } catch {
                      // Error handled by parent
                    }
                  }}
                >
                  <Trash2 size={14} />
                  Delete Forever
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Portal-based dropdown for user actions */}
        {activeDropdown && createPortal(
          <div
            className="user-actions-dropdown-portal"
            style={{
              position: 'fixed',
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              zIndex: 10000,
            }}
          >
            <div className="user-actions-dropdown">
              {(() => {
                const targetUser = users.find(u => u.user_id === activeDropdown);
                const isSelf = targetUser?.user_id === currentUserId;
                // Admin cannot manage system users
                const canManageUser = isSystem || (userRole === 'admin' && targetUser?.role !== 'system');

                if (isSystem) {
                  // System user: Edit + Delete
                  return (
                    <>
                      <button onClick={() => {
                        if (targetUser) openEditModal(targetUser);
                      }}>
                        <Settings size={14} />
                        Edit User
                      </button>
                      {!isSelf && (
                        <>
                          <button
                            className="danger"
                            onClick={() => {
                              if (targetUser) {
                                setDeletingUser(targetUser);
                                setDeleteConfirmEmail('');
                              }
                              setActiveDropdown(null);
                            }}
                          >
                            <Trash2 size={14} />
                            Delete User
                          </button>
                        </>
                      )}
                    </>
                  );
                } else {
                  // Admin user: Edit Role + Remove from Workspace
                  return (
                    <>
                      {canManageUser && (
                        <button onClick={() => {
                          if (targetUser) openEditModal(targetUser);
                        }}>
                          Edit Role
                        </button>
                      )}
                      {canManageUser && !isSelf && (
                        <button
                          className="danger"
                          onClick={() => {
                            setActiveDropdown(null);
                            void handleRemoveFromWorkspace(targetUser);
                          }}
                        >
                          Remove from Workspace
                        </button>
                      )}
                    </>
                  );
                }
              })()}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
