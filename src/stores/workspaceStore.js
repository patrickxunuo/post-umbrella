import { create } from 'zustand';
import * as data from '../data/index.js';

const parsePendingSharedLink = () => {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');
  const id = params.get('id');
  if (type && id) return { type, id };
  const requestId = params.get('request_id');
  const exampleId = params.get('example_id');
  if (requestId) return { type: 'request', id: requestId };
  if (exampleId) return { type: 'example', id: exampleId };
  return null;
};

const useWorkspaceStore = create((set, get) => ({
  // UI helpers (set once at provider mount)
  _toast: null,
  _prompt: null,
  setHelpers: (toast, prompt) => set({ _toast: toast, _prompt: prompt }),

  // State
  activeWorkspace: null,
  pendingSharedLink: parsePendingSharedLink(),
  workspaces: [],
  workspaceMembers: [],
  showWorkspaceSettings: false,
  showUserManagement: false,
  userProfile: null,
  allUsers: [],
  allWorkspaces: [],
  workspacesLoading: false,
  usersLoading: false,
  workspaceBootstrapComplete: false,

  // Setters
  setActiveWorkspace: (ws) => set({ activeWorkspace: ws }),
  setShowWorkspaceSettings: (v) => set({ showWorkspaceSettings: v }),
  setShowUserManagement: (v) => set({ showUserManagement: v }),

  consumePendingSharedLink: () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('type');
    url.searchParams.delete('id');
    url.searchParams.delete('request_id');
    url.searchParams.delete('example_id');
    const search = url.searchParams.toString();
    window.history.replaceState({}, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
    set({ pendingSharedLink: null });
  },

  // Data loading
  loadWorkspaces: async () => {
    const { activeWorkspace } = get();
    set({ workspacesLoading: true, workspaceBootstrapComplete: false });
    try {
      const nextWorkspaces = await data.getWorkspaces();
      set({ workspaces: nextWorkspaces });

      if (!activeWorkspace) {
        const nextActive = await data.getActiveWorkspace();
        set({ activeWorkspace: nextActive });
      }
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    } finally {
      set({ workspacesLoading: false, workspaceBootstrapComplete: true });
    }
  },

  loadUserProfile: async () => {
    try {
      const profile = await data.getUserProfile();
      set({ userProfile: profile });
    } catch (err) {
      console.error('Failed to load user profile:', err);
    }
  },

  loadAllUsers: async () => {
    const { userProfile } = get();
    if (!userProfile || !['admin', 'system'].includes(userProfile.role)) return;
    set({ usersLoading: true });
    try {
      const users = await data.getAllUsers();
      const workspaces = await data.getAllWorkspaces();
      set({ allWorkspaces: workspaces });

      const enrichedUsers = await Promise.all(
        users.map(async (profile) => {
          const userWorkspaces = await data.getUserWorkspaces(profile.user_id);
          return { ...profile, workspaces: userWorkspaces };
        })
      );
      set({ allUsers: enrichedUsers });
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      set({ usersLoading: false });
    }
  },

  loadWorkspaceMembers: async () => {
    const { activeWorkspace } = get();
    if (!activeWorkspace?.id) return;
    try {
      const members = await data.getWorkspaceMembers(activeWorkspace.id);
      set({ workspaceMembers: members });
    } catch (err) {
      console.error('Failed to load workspace members:', err);
    }
  },

  // Actions
  handleWorkspaceChange: async (workspace) => {
    const { _toast: toast } = get();
    try {
      await data.setActiveWorkspace(workspace.id);
      set({ activeWorkspace: workspace });
    } catch {
      toast?.error('Failed to switch workspace');
    }
  },

  handleCreateWorkspace: async () => {
    const { _toast: toast, _prompt: prompt, handleWorkspaceChange } = get();
    const name = await prompt({
      title: 'Create Workspace',
      message: 'Enter a name for the new workspace:',
      placeholder: 'Workspace name',
    });
    if (!name) return;

    try {
      const workspace = await data.createWorkspace(name);
      set((s) => ({ workspaces: [...s.workspaces, workspace] }));
      await handleWorkspaceChange(workspace);
      toast?.success(`Workspace "${name}" created`);
    } catch (err) {
      toast?.error(err.message || 'Failed to create workspace');
    }
  },

  handleOpenWorkspaceSettings: async () => {
    const { loadWorkspaceMembers } = get();
    await loadWorkspaceMembers();
    set({ showWorkspaceSettings: true });
  },

  handleUpdateWorkspace: async (workspaceId, updates) => {
    const { _toast: toast } = get();
    try {
      const updated = await data.updateWorkspace(workspaceId, updates);
      set((s) => ({
        activeWorkspace: s.activeWorkspace ? { ...s.activeWorkspace, ...updated } : null,
        workspaces: s.workspaces.map((ws) => (
          ws.id === workspaceId ? { ...ws, ...updated } : ws
        )),
      }));
      toast?.success('Workspace updated');
    } catch (err) {
      toast?.error(err.message || 'Failed to update workspace');
    }
  },

  handleAddWorkspaceMember: async (workspaceId, email) => {
    const { _toast: toast, loadWorkspaceMembers } = get();
    try {
      await data.addWorkspaceMember(workspaceId, email);
      await loadWorkspaceMembers();
      toast?.success(`Added ${email} to workspace`);
    } catch (err) {
      toast?.error(err.message || 'Failed to add member');
    }
  },

  handleRemoveWorkspaceMember: async (workspaceId, userId) => {
    const { _toast: toast, loadWorkspaceMembers } = get();
    try {
      await data.removeWorkspaceMember(workspaceId, userId);
      await loadWorkspaceMembers();
      toast?.success('Member removed');
    } catch (err) {
      toast?.error(err.message || 'Failed to remove member');
    }
  },

  handleDeleteWorkspace: async (workspaceId) => {
    const { _toast: toast, workspaces, handleWorkspaceChange } = get();
    try {
      await data.deleteWorkspace(workspaceId);
      const remaining = workspaces.filter((ws) => ws.id !== workspaceId);
      set({ workspaces: remaining, showWorkspaceSettings: false });

      if (remaining.length > 0) {
        await handleWorkspaceChange(remaining[0]);
      } else {
        set({ activeWorkspace: null });
      }
      toast?.success('Workspace deleted');
    } catch (err) {
      toast?.error(err.message || 'Failed to delete workspace');
    }
  },

  handleInviteUser: async (email, role, workspaceIds) => {
    const { _toast: toast, loadAllUsers } = get();
    try {
      await data.inviteUser(email, role, workspaceIds);
      toast?.success(`Invitation sent to ${email}`);
      loadAllUsers();
      return true;
    } catch (err) {
      toast?.error(err.message || 'Failed to invite user');
      throw err;
    }
  },

  handleUpdateUser: async (userId, updates) => {
    const { _toast: toast, loadAllUsers } = get();
    try {
      await data.updateUserProfile(userId, updates);
      toast?.success('User updated');
      loadAllUsers();
      return true;
    } catch (err) {
      toast?.error(err.message || 'Failed to update user');
      throw err;
    }
  },

  handleUpdateUserWorkspaces: async (userId, workspaceIds) => {
    const { _toast: toast, loadAllUsers } = get();
    try {
      await data.updateUserWorkspaces(userId, workspaceIds);
      toast?.success('User workspaces updated');
      loadAllUsers();
      return true;
    } catch (err) {
      toast?.error(err.message || 'Failed to update user workspaces');
      throw err;
    }
  },

  handleDeleteUser: async (userId) => {
    const { _toast: toast, loadAllUsers } = get();
    try {
      const result = await data.deleteUser(userId);
      toast?.success(`Deleted ${result.email || 'user'}`);
      loadAllUsers();
      return result;
    } catch (err) {
      toast?.error(err.message || 'Failed to delete user');
      throw err;
    }
  },

  // Reset on logout
  reset: () => set({
    activeWorkspace: null,
    workspaces: [],
    workspaceMembers: [],
    showWorkspaceSettings: false,
    showUserManagement: false,
    userProfile: null,
    allUsers: [],
    allWorkspaces: [],
    workspacesLoading: false,
    usersLoading: false,
    workspaceBootstrapComplete: false,
  }),
}));

export default useWorkspaceStore;
