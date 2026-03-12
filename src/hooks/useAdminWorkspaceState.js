import { useCallback, useEffect, useState } from 'react';
import * as data from '../data/index.js';

export function useAdminWorkspaceState({
  user,
  activeWorkspace,
  setActiveWorkspace,
  prompt,
  toast,
}) {
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [allWorkspaces, setAllWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [workspaceBootstrapComplete, setWorkspaceBootstrapComplete] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    if (!user) return;
    setWorkspacesLoading(true);
    setWorkspaceBootstrapComplete(false);
    try {
      const nextWorkspaces = await data.getWorkspaces();
      setWorkspaces(nextWorkspaces);

      if (!activeWorkspace) {
        const nextActiveWorkspace = await data.getActiveWorkspace();
        setActiveWorkspace(nextActiveWorkspace);
      }
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    } finally {
      setWorkspacesLoading(false);
      setWorkspaceBootstrapComplete(true);
    }
  }, [user, activeWorkspace, setActiveWorkspace]);

  const loadUserProfile = useCallback(async () => {
    if (!user) return;
    try {
      const profile = await data.getUserProfile();
      setUserProfile(profile);
    } catch (err) {
      console.error('Failed to load user profile:', err);
    }
  }, [user]);

  const loadAllUsers = useCallback(async () => {
    if (!userProfile || !['admin', 'system'].includes(userProfile.role)) return;
    setUsersLoading(true);
    try {
      const users = await data.getAllUsers();
      const workspaces = await data.getAllWorkspaces();
      setAllWorkspaces(workspaces);

      const enrichedUsers = await Promise.all(
        users.map(async (profile) => {
          const userWorkspaces = await data.getUserWorkspaces(profile.user_id);
          return { ...profile, workspaces: userWorkspaces };
        })
      );
      setAllUsers(enrichedUsers);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setUsersLoading(false);
    }
  }, [userProfile]);

  const handleWorkspaceChange = useCallback(async (workspace) => {
    try {
      await data.setActiveWorkspace(workspace.id);
      setActiveWorkspace(workspace);
    } catch (err) {
      toast.error('Failed to switch workspace');
    }
  }, [setActiveWorkspace, toast]);

  const handleCreateWorkspace = useCallback(async () => {
    const name = await prompt({
      title: 'Create Workspace',
      message: 'Enter a name for the new workspace:',
      placeholder: 'Workspace name',
    });
    if (!name) return;

    try {
      const workspace = await data.createWorkspace(name);
      setWorkspaces((prev) => [...prev, workspace]);
      await handleWorkspaceChange(workspace);
      toast.success(`Workspace "${name}" created`);
    } catch (err) {
      toast.error(err.message || 'Failed to create workspace');
    }
  }, [handleWorkspaceChange, prompt, toast]);

  const loadWorkspaceMembers = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const members = await data.getWorkspaceMembers(activeWorkspace.id);
      setWorkspaceMembers(members);
    } catch (err) {
      console.error('Failed to load workspace members:', err);
    }
  }, [activeWorkspace]);

  const handleOpenWorkspaceSettings = useCallback(async () => {
    await loadWorkspaceMembers();
    setShowWorkspaceSettings(true);
  }, [loadWorkspaceMembers]);

  const handleUpdateWorkspace = useCallback(async (workspaceId, updates) => {
    try {
      const updated = await data.updateWorkspace(workspaceId, updates);
      setActiveWorkspace((prev) => (prev ? { ...prev, ...updated } : null));
      setWorkspaces((prev) => prev.map((workspace) => (
        workspace.id === workspaceId ? { ...workspace, ...updated } : workspace
      )));
      toast.success('Workspace updated');
    } catch (err) {
      toast.error(err.message || 'Failed to update workspace');
    }
  }, [setActiveWorkspace, toast]);

  const handleAddWorkspaceMember = useCallback(async (workspaceId, email) => {
    try {
      await data.addWorkspaceMember(workspaceId, email);
      await loadWorkspaceMembers();
      toast.success(`Added ${email} to workspace`);
    } catch (err) {
      toast.error(err.message || 'Failed to add member');
    }
  }, [loadWorkspaceMembers, toast]);

  const handleRemoveWorkspaceMember = useCallback(async (workspaceId, userId) => {
    try {
      await data.removeWorkspaceMember(workspaceId, userId);
      await loadWorkspaceMembers();
      toast.success('Member removed');
    } catch (err) {
      toast.error(err.message || 'Failed to remove member');
    }
  }, [loadWorkspaceMembers, toast]);

  const handleDeleteWorkspace = useCallback(async (workspaceId) => {
    try {
      await data.deleteWorkspace(workspaceId);
      const remaining = workspaces.filter((workspace) => workspace.id !== workspaceId);
      setWorkspaces(remaining);

      if (remaining.length > 0) {
        await handleWorkspaceChange(remaining[0]);
      } else {
        setActiveWorkspace(null);
      }

      setShowWorkspaceSettings(false);
      toast.success('Workspace deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete workspace');
    }
  }, [handleWorkspaceChange, setActiveWorkspace, toast, workspaces]);

  const handleInviteUser = useCallback(async (email, role, workspaceIds) => {
    try {
      await data.inviteUser(email, role, workspaceIds);
      toast.success(`Invitation sent to ${email}`);
      loadAllUsers();
      return true;
    } catch (err) {
      toast.error(err.message || 'Failed to invite user');
      throw err;
    }
  }, [loadAllUsers, toast]);

  const handleUpdateUser = useCallback(async (userId, updates) => {
    try {
      await data.updateUserProfile(userId, updates);
      toast.success('User updated');
      loadAllUsers();
      return true;
    } catch (err) {
      toast.error(err.message || 'Failed to update user');
      throw err;
    }
  }, [loadAllUsers, toast]);

  const handleUpdateUserWorkspaces = useCallback(async (userId, workspaceIds) => {
    try {
      await data.updateUserWorkspaces(userId, workspaceIds);
      toast.success('User workspaces updated');
      loadAllUsers();
      return true;
    } catch (err) {
      toast.error(err.message || 'Failed to update user workspaces');
      throw err;
    }
  }, [loadAllUsers, toast]);

  const handleDeleteUser = useCallback(async (userId) => {
    try {
      const result = await data.deleteUser(userId);
      toast.success(`Deleted ${result.email || 'user'}`);
      loadAllUsers();
      return result;
    } catch (err) {
      toast.error(err.message || 'Failed to delete user');
      throw err;
    }
  }, [loadAllUsers, toast]);

  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setWorkspaceMembers([]);
      setShowWorkspaceSettings(false);
      setShowUserManagement(false);
      setUserProfile(null);
      setAllUsers([]);
      setAllWorkspaces([]);
      setWorkspacesLoading(false);
      setUsersLoading(false);
      setWorkspaceBootstrapComplete(false);
      return;
    }

    loadWorkspaces();
    loadUserProfile();
  }, [user, loadWorkspaces, loadUserProfile]);

  useEffect(() => {
    if (user) {
      if (showUserManagement && ['admin', 'system'].includes(userProfile?.role)) {
        loadAllUsers();
      }
    }
  }, [showUserManagement, userProfile?.role, loadAllUsers, user]);

  return {
    workspaces,
    workspaceMembers,
    showWorkspaceSettings,
    setShowWorkspaceSettings,
    showUserManagement,
    setShowUserManagement,
    userProfile,
    allUsers,
    allWorkspaces,
    workspacesLoading,
    usersLoading,
    workspaceBootstrapComplete,
    handleWorkspaceChange,
    handleCreateWorkspace,
    handleOpenWorkspaceSettings,
    handleUpdateWorkspace,
    handleAddWorkspaceMember,
    handleRemoveWorkspaceMember,
    handleDeleteWorkspace,
    handleInviteUser,
    handleUpdateUser,
    handleUpdateUserWorkspaces,
    handleDeleteUser,
  };
}
