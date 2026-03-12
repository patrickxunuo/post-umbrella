import { useCallback, useEffect, useRef, useState } from 'react';
import * as data from '../data/index.js';

/**
 * Hook to manage workspace presence - tracks who's online in the current workspace.
 * Shows all workspace members with their online/offline status and last seen time.
 *
 * @param {Object} options
 * @param {Object} options.user - Current authenticated user
 * @param {Object} options.activeWorkspace - Currently active workspace
 * @param {Object} options.userProfile - Current user's profile (for display_name, avatar)
 * @returns {Object} Presence state and members with online status
 */
export function useWorkspacePresence({ user, activeWorkspace, userProfile }) {
  const [members, setMembers] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const channelRef = useRef(null);

  // Load workspace members (minimal data for presence)
  const loadMembers = useCallback(async () => {
    if (!activeWorkspace?.id) {
      setMembers([]);
      setLoading(false);
      return;
    }

    try {
      console.log('Loading workspace members for:', activeWorkspace.id);
      const workspaceMembers = await data.getWorkspaceMembersMinimal(activeWorkspace.id);
      console.log('Workspace members result:', workspaceMembers);
      setMembers(workspaceMembers);
    } catch (err) {
      console.error('Failed to load workspace members for presence:', err);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  // Join presence channel and track user
  useEffect(() => {
    if (!user || !activeWorkspace?.id) {
      setOnlineUserIds(new Set());
      return;
    }

    let isMounted = true;

    const setupPresence = async () => {
      try {
        // Join presence channel
        const channel = await data.joinWorkspacePresence(activeWorkspace.id, {
          user_id: user.id,
          email: user.email,
          display_name: userProfile?.display_name || user.email,
          avatar_url: userProfile?.avatar_url || null,
        });

        if (!isMounted) return;

        channelRef.current = channel;

        // Handle presence sync (initial state)
        channel.on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          const onlineIds = new Set(Object.keys(state));
          if (isMounted) {
            setOnlineUserIds(onlineIds);
          }
        });

        // Handle presence join
        channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
          if (isMounted) {
            setOnlineUserIds(prev => new Set([...prev, key]));
          }
        });

        // Handle presence leave
        channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          if (isMounted) {
            setOnlineUserIds(prev => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            });
          }
        });

        // Subscribe to channel
        channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && isMounted) {
            // Track our presence
            await data.trackPresence({
              user_id: user.id,
              email: user.email,
              display_name: userProfile?.display_name || user.email,
              avatar_url: userProfile?.avatar_url || null,
              online_at: new Date().toISOString(),
            });
          }
        });
      } catch (err) {
        console.error('Failed to setup presence:', err);
      }
    };

    setupPresence();
    loadMembers();

    // Cleanup on unmount or workspace change
    return () => {
      isMounted = false;
      data.leaveWorkspacePresence();
      channelRef.current = null;
    };
  }, [user, activeWorkspace?.id, userProfile?.display_name, userProfile?.avatar_url, loadMembers]);

  // Combine members with online status (current user is always online)
  const membersWithPresence = members.map(member => ({
    ...member,
    is_online: member.user_id === user?.id || onlineUserIds.has(member.user_id),
  }));

  // Sort: 1) me first, 2) active users, 3) inactive by recency
  const sortedMembers = [...membersWithPresence].sort((a, b) => {
    // Me always first
    const aIsMe = a.user_id === user?.id;
    const bIsMe = b.user_id === user?.id;
    if (aIsMe && !bIsMe) return -1;
    if (!aIsMe && bIsMe) return 1;

    // Then online users
    if (a.is_online && !b.is_online) return -1;
    if (!a.is_online && b.is_online) return 1;

    // Then by last_seen (most recent first)
    const aLastSeen = a.last_seen || 0;
    const bLastSeen = b.last_seen || 0;
    return bLastSeen - aLastSeen;
  });

  return {
    members: sortedMembers,
    onlineCount: onlineUserIds.size,
    totalCount: members.length,
    loading,
    refreshMembers: loadMembers,
  };
}

/**
 * Format last seen timestamp to human-readable string
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Human-readable string like "Active now", "5 minutes ago", "3 days ago"
 */
export function formatLastSeen(timestamp, isOnline = false) {
  if (isOnline) {
    return 'Active now';
  }

  if (!timestamp) {
    return 'Never active';
  }

  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) {
    return 'Just now';
  }

  if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  if (diff < 604800) {
    const days = Math.floor(diff / 86400);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  if (diff < 2592000) {
    const weeks = Math.floor(diff / 604800);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }

  const months = Math.floor(diff / 2592000);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
