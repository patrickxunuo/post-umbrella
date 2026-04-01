// User profiles, workspaces, members, presence, config
import { supabase } from './client.js';
import { checkAuth } from './helpers.js';

// ============================================
// USER PROFILES
// ============================================

// Get current user's profile
export const getUserProfile = async () => {
  const user = await checkAuth();

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  console.log('getUserProfile result:', { data, error });

  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data;
};

// Get all users (admin only)
export const getAllUsers = async () => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

// Update user profile (admin only, or self for activation)
export const updateUserProfile = async (userId, updates) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .update({
      ...updates,
      updated_at: Math.floor(Date.now() / 1000),
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
};

// Delete user (admin only - via edge function)
export const deleteUser = async (userId) => {
  const response = await fetch(`${PROXY_FUNCTION_URL.replace('/proxy', '/delete-user')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify({ userId }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to delete user');
  }

  return result;
};

// Bootstrap/activate user on login (via database function)
// Handles: pending activation, first-user-becomes-admin, unauthorized access
export const activateUser = async () => {
  // Debug: check current user
  const { data: { user } } = await supabase.auth.getUser();
  console.log('Current auth user:', user?.id, user?.email);

  // Debug: test auth.uid() directly
  const { data: uidData, error: uidError } = await supabase.rpc('get_my_uid');
  console.log('get_my_uid result:', { uidData, uidError });

  const { data, error } = await supabase.rpc('bootstrap_or_activate_user');

  console.log('bootstrap_or_activate_user result:', { data, error });

  if (error) {
    throw new Error(error.message || 'Failed to activate user');
  }

  if (!data.success) {
    const err = new Error(data.message || 'User activation failed');
    err.action = data.action;
    throw err;
  }

  return data;
};

// Invite new user (admin only - via edge function)
export const inviteUser = async (email, role, workspaceIds = []) => {
  const response = await fetch(`${PROXY_FUNCTION_URL.replace('/proxy', '/invite-user')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify({ email, role, workspaceIds }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to invite user');
  }

  return response.json();
};

// Get user's workspaces (for admin management)
export const getUserWorkspaces = async (userId) => {
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      workspace:workspaces (
        id,
        name
      )
    `)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return data.map(wm => wm.workspace).filter(Boolean);
};

// Update user's workspace memberships (admin only)
export const updateUserWorkspaces = async (userId, workspaceIds) => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);

  // Get current memberships
  const { data: current } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId);

  const currentIds = current?.map(m => m.workspace_id) || [];
  const toAdd = workspaceIds.filter(id => !currentIds.includes(id));
  const toRemove = currentIds.filter(id => !workspaceIds.includes(id));

  // Add new memberships
  if (toAdd.length > 0) {
    const { error: addError } = await supabase
      .from('workspace_members')
      .insert(toAdd.map(wsId => ({
        workspace_id: wsId,
        user_id: userId,
        added_by: user.id,
        created_at: now,
      })));
    if (addError) throw new Error(addError.message);
  }

  // Remove old memberships
  if (toRemove.length > 0) {
    const { error: removeError } = await supabase
      .from('workspace_members')
      .delete()
      .eq('user_id', userId)
      .in('workspace_id', toRemove);
    if (removeError) throw new Error(removeError.message);
  }

  return { success: true };
};

// ============================================
// WORKSPACES
// ============================================

// Get all workspaces the current user belongs to
export const getWorkspaces = async () => {
  const user = await checkAuth();

  // Check if user is system - they can see all workspaces
  const profile = await getUserProfile();
  if (profile?.role === 'system') {
    // System users get all workspaces directly
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, description, created_by, created_at, updated_at')
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  // Regular users get workspaces via membership
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      workspace:workspaces (
        id,
        name,
        description,
        created_by,
        created_at,
        updated_at
      )
    `)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);

  return data.map(wm => wm.workspace).filter(Boolean);
};

// Get all workspaces (admin only, for user management)
export const getAllWorkspaces = async () => {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

// Get a single workspace with member count
export const getWorkspace = async (id) => {
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);

  // Get member count
  const { count } = await supabase
    .from('workspace_members')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', id);

  return { ...workspace, member_count: count || 0 };
};

// Create a new workspace (admin only - via RPC to bypass RLS)
export const createWorkspace = async (name, description = '') => {
  const { data, error } = await supabase.rpc('create_workspace_rpc', {
    ws_name: name,
    ws_description: description || '',
  });

  if (error) throw new Error(error.message);
  if (!data.success) throw new Error(data.message);

  // The RPC function handles creating the workspace, adding creator as member,
  // and setting it as active workspace
  return data.workspace;
};

// Update workspace (admin only - RLS enforced)
export const updateWorkspace = async (id, updates) => {
  const { data, error } = await supabase
    .from('workspaces')
    .update({
      ...updates,
      updated_at: Math.floor(Date.now() / 1000),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
};

// Delete workspace (admin only - RLS enforced)
export const deleteWorkspace = async (id) => {
  const { error } = await supabase
    .from('workspaces')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
  return null;
};

// ============================================
// WORKSPACE MEMBERS
// ============================================

// Get members of a workspace (with their profiles) - for admin use
export const getWorkspaceMembers = async (workspaceId) => {
  const { data: memberships, error } = await supabase
    .from('workspace_members')
    .select('user_id, added_by, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  if (!memberships || memberships.length === 0) return [];

  const userIds = memberships.map(member => member.user_id);

  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('user_id, email, role, status, display_name, avatar_url, last_seen')
    .in('user_id', userIds);

  if (profilesError) throw new Error(profilesError.message);

  const profileMap = new Map((profiles || []).map(profile => [profile.user_id, profile]));

  return memberships.map(member => {
    const profile = profileMap.get(member.user_id);
    return {
      user_id: member.user_id,
      added_by: member.added_by,
      created_at: member.created_at,
      email: profile?.email || null,
      role: profile?.role || null,
      status: profile?.status || null,
      display_name: profile?.display_name || null,
      avatar_url: profile?.avatar_url || null,
      last_seen: profile?.last_seen || null,
    };
  });
};

// Get minimal workspace members info (for presence avatars - all users can access)
export const getWorkspaceMembersMinimal = async (workspaceId) => {
  const { data, error } = await supabase.rpc('get_workspace_members_minimal', {
    ws_id: workspaceId,
  });

  if (error) throw new Error(error.message);
  return data || [];
};

// Add existing user to workspace (admin only - via edge function)
export const addWorkspaceMember = async (workspaceId, email) => {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${PROXY_FUNCTION_URL.replace('/proxy', '/add-workspace-member')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ workspaceId, email }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to add member');
  }

  return result;
};

// Remove member from workspace (admin only)
export const removeWorkspaceMember = async (workspaceId, userId) => {
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return null;
};

// ============================================
// ACTIVE WORKSPACE
// ============================================

// Get user's active workspace
export const getActiveWorkspace = async () => {
  const user = await checkAuth();

  const { data, error } = await supabase
    .from('user_active_workspace')
    .select(`
      workspace_id,
      workspace:workspaces (
        id,
        name,
        description
      )
    `)
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') throw new Error(error.message);

  if (!data?.workspace) {
    // No active workspace set, return first workspace user belongs to
    const workspaces = await getWorkspaces();
    if (workspaces.length > 0) {
      await setActiveWorkspace(workspaces[0].id);
      return workspaces[0];
    }
    return null;
  }

  return data.workspace;
};

// Set user's active workspace
export const setActiveWorkspace = async (workspaceId) => {
  const user = await checkAuth();

  const { error } = await supabase
    .from('user_active_workspace')
    .upsert({
      user_id: user.id,
      workspace_id: workspaceId,
    }, {
      onConflict: 'user_id',
    });

  if (error) throw new Error(error.message);
  return { success: true };
};

// ============================================
// PERMISSION HELPERS
// ============================================

// Get current user's global role
export const getUserRole = async () => {
  const profile = await getUserProfile();
  return profile?.role || null;
};

// Check if current user can edit (developer or admin with active status)
export const canEdit = async () => {
  const profile = await getUserProfile();
  return profile?.status === 'active' && (profile?.role === 'developer' || profile?.role === 'admin');
};

// Check if current user is admin
export const isAdmin = async () => {
  const profile = await getUserProfile();
  return profile?.status === 'active' && profile?.role === 'admin';
};

// Check if current user is a member of a workspace
export const isMemberOf = async (workspaceId) => {
  const user = await checkAuth();

  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .single();

  if (error) return false;
  return !!data;
};

// ============================================
// WORKSPACE PRESENCE
// ============================================

let presenceChannel = null;
let presenceHeartbeatInterval = null;

// Update user's last_seen timestamp in database
export const updateLastSeen = async () => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);

  const { error } = await supabase
    .from('user_profiles')
    .update({ last_seen: now })
    .eq('user_id', user.id);

  if (error) {
    console.warn('Failed to update last_seen:', error.message);
  }
};

// Join workspace presence channel
export const joinWorkspacePresence = async (workspaceId, userInfo) => {
  const user = await checkAuth();

  // Leave existing channel if any
  if (presenceChannel) {
    await supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  // Clear any existing heartbeat
  if (presenceHeartbeatInterval) {
    clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = null;
  }

  // Create presence channel for this workspace
  const channelName = `workspace:${workspaceId}:presence`;

  presenceChannel = supabase.channel(channelName, {
    config: {
      presence: {
        key: user.id,
      },
    },
  });

  // Update last_seen immediately and start heartbeat (every 60 seconds)
  await updateLastSeen();
  presenceHeartbeatInterval = setInterval(updateLastSeen, 60000);

  return presenceChannel;
};

// Track user presence with state
export const trackPresence = async (state) => {
  if (!presenceChannel) return;

  await presenceChannel.track(state);
};

// Leave workspace presence channel
export const leaveWorkspacePresence = async () => {
  // Update last_seen one final time before leaving
  await updateLastSeen();

  // Clear heartbeat
  if (presenceHeartbeatInterval) {
    clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = null;
  }

  if (presenceChannel) {
    await presenceChannel.untrack();
    await supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }
};

// Get current presence channel (for subscribing to events)
export const getPresenceChannel = () => presenceChannel;

// ==================== User Config ====================

export const getUserConfig = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  const { data, error } = await supabase
    .from('user_config')
    .select('config')
    .eq('user_id', user.id)
    .single();

  if (error && error.code === 'PGRST116') return {}; // No row yet
  if (error) throw new Error(error.message);
  return data.config || {};
};

export const updateUserConfig = async (patch) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Read current config first
  const current = await getUserConfig();
  const merged = { ...current, ...patch };

  const { data, error } = await supabase
    .from('user_config')
    .upsert({
      user_id: user.id,
      config: merged,
      updated_at: Math.floor(Date.now() / 1000),
    }, { onConflict: 'user_id' })
    .select('config')
    .single();

  if (error) throw new Error(error.message);
  return data.config;
};


