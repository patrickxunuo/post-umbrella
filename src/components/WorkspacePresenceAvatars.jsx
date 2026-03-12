import { useWorkspacePresence, formatLastSeen } from '../hooks/useWorkspacePresence';

/**
 * Get initials from email (first letter + last letter before @)
 * Example: patrickx@emonster.ca → PX
 */
export function getInitials(email) {
  if (!email) return '??';
  const local = email.split('@')[0];
  if (local.length === 0) return '??';
  if (local.length === 1) return local.toUpperCase();
  return (local[0] + local[local.length - 1]).toUpperCase();
}

/**
 * Generate a consistent color based on email
 */
export function getAvatarColor(email) {
  if (!email) return 'hsl(0, 0%, 60%)';

  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 55%, 50%)`;
}

export function WorkspacePresenceAvatars({ user, activeWorkspace, userProfile }) {
  const { members, loading } = useWorkspacePresence({
    user,
    activeWorkspace,
    userProfile,
  });

  // Don't render if no workspace or still loading
  if (!activeWorkspace || loading) {
    return null;
  }

  // If no members loaded but we have a user, show at least the current user
  const displayMembers = members.length > 0 ? members : (user ? [{
    user_id: user.id,
    email: user.email,
    role: userProfile?.role || null,
    is_online: true,
    last_seen: null,
  }] : []);

  if (displayMembers.length === 0) {
    return null;
  }

  // Limit displayed avatars, show overflow count
  const maxVisible = 5;
  const visibleMembers = displayMembers.slice(0, maxVisible);
  const overflowCount = displayMembers.length - maxVisible;

  return (
    <div className="presence-avatars">
      {visibleMembers.map((member) => {
        const isMe = member.user_id === user?.id;
        const initials = getInitials(member.email);
        const color = getAvatarColor(member.email);
        const statusText = formatLastSeen(member.last_seen, member.is_online);

        return (
          <div
            key={member.user_id}
            className={`presence-avatar ${member.is_online ? 'online' : 'offline'}`}
            style={{ '--avatar-color': color }}
            title={`${member.email}${isMe ? ' (You)' : ''}\n${statusText}`}
          >
            <span className="presence-avatar-initials">{initials}</span>
            <div className="presence-tooltip">
              <div className="presence-tooltip-row">
                {member.role && (
                  <span className={`presence-tooltip-role ${member.role}`}>{member.role}</span>
                )}
                <span className="presence-tooltip-email">{member.email}</span>
                {isMe && <span className="presence-tooltip-you">(You)</span>}
              </div>
              <div className={`presence-tooltip-status ${member.is_online ? 'active' : ''}`}>
                {statusText}
              </div>
            </div>
          </div>
        );
      })}
      {overflowCount > 0 && (
        <div className="presence-avatar overflow">
          <span className="presence-avatar-initials">+{overflowCount}</span>
        </div>
      )}
    </div>
  );
}
