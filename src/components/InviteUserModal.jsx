import { useState, useEffect, useRef } from 'react';
import {
  X,
  UserPlus,
  Crown,
  Code,
  Eye,
  Mail,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useToast } from './Toast';

// Optional email domain restriction from env
const EMAIL_DOMAIN = import.meta.env.VITE_EMAIL_DOMAIN || '';

export function InviteUserModal({
  workspaceName,
  userRole = 'developer',
  onInvite,
  onClose,
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('developer');
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [inviting, setInviting] = useState(false);
  const roleDropdownRef = useRef(null);

  // Validate email domain if restriction is set
  const isEmailValid = (emailAddr) => {
    if (!EMAIL_DOMAIN) return true;
    return emailAddr.endsWith(EMAIL_DOMAIN);
  };

  // Get available roles based on user's role
  const getInvitableRoles = () => {
    switch (userRole) {
      case 'system': return ['admin', 'developer', 'reader'];
      case 'admin': return ['admin', 'developer', 'reader'];
      case 'developer': return ['developer', 'reader'];
      default: return [];
    }
  };

  const getRoleIcon = (r) => {
    switch (r) {
      case 'admin': return <Crown size={14} />;
      case 'developer': return <Code size={14} />;
      case 'reader': return <Eye size={14} />;
      default: return null;
    }
  };

  const getRoleLabel = (r) => {
    switch (r) {
      case 'admin': return 'Admin';
      case 'developer': return 'Developer';
      case 'reader': return 'Reader';
      default: return r;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    if (!isEmailValid(email.trim())) {
      toast.warning(`Only ${EMAIL_DOMAIN} emails are allowed`);
      return;
    }

    setInviting(true);
    try {
      await onInvite(email.trim(), role);
      setEmail('');
      setRole('developer');
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setInviting(false);
    }
  };

  // Close dropdown on outside click
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

  return (
    <div className="invite-modal-overlay" onClick={onClose}>
      <div className="invite-modal" onClick={e => e.stopPropagation()}>
        <div className="invite-modal-header">
          <div className="invite-modal-title">
            <UserPlus size={18} />
            <span>Invite to {workspaceName}</span>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="invite-modal-body" onSubmit={handleSubmit}>
          <div className="invite-modal-field">
            <label>Email</label>
            <div className="invite-modal-input">
              <Mail size={14} />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={EMAIL_DOMAIN ? `user${EMAIL_DOMAIN}` : 'user@example.com'}
                autoFocus
                required
              />
            </div>
          </div>

          <div className="invite-modal-field">
            <label>Role</label>
            <div className="invite-modal-role" ref={roleDropdownRef}>
              <button
                type="button"
                className="invite-modal-role-btn"
                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
              >
                {getRoleIcon(role)}
                <span>{getRoleLabel(role)}</span>
                <ChevronDown size={14} className={showRoleDropdown ? 'open' : ''} />
              </button>
              {showRoleDropdown && (
                <div className="invite-modal-role-dropdown">
                  {getInvitableRoles().map(r => (
                    <button
                      key={r}
                      type="button"
                      className={`invite-modal-role-option role-${r} ${role === r ? 'selected' : ''}`}
                      onClick={() => {
                        setRole(r);
                        setShowRoleDropdown(false);
                      }}
                    >
                      {getRoleIcon(r)}
                      <span>{getRoleLabel(r)}</span>
                      {role === r && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="invite-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={inviting || !email.trim()}
            >
              <UserPlus size={14} />
              {inviting ? 'Inviting...' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
