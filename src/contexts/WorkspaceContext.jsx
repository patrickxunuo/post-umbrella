import { useEffect } from 'react';
import { useToast } from '../components/Toast';
import { usePrompt } from '../components/PromptModal';
import useAuthStore from '../stores/authStore';
import useWorkspaceStore from '../stores/workspaceStore';

export function WorkspaceProvider({ children, prompt: promptProp, toast: toastProp }) {
  const user = useAuthStore((s) => s.user);
  const setHelpers = useWorkspaceStore((s) => s.setHelpers);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const loadUserProfile = useWorkspaceStore((s) => s.loadUserProfile);
  const reset = useWorkspaceStore((s) => s.reset);
  const showUserManagement = useWorkspaceStore((s) => s.showUserManagement);
  const userProfile = useWorkspaceStore((s) => s.userProfile);
  const loadAllUsers = useWorkspaceStore((s) => s.loadAllUsers);

  // Set toast/prompt refs in store
  useEffect(() => {
    setHelpers(toastProp, promptProp);
  }, [toastProp, promptProp, setHelpers]);

  // Load workspaces + profile when user changes
  useEffect(() => {
    if (!user) {
      reset();
      return;
    }
    loadWorkspaces();
    loadUserProfile();
  }, [user, loadWorkspaces, loadUserProfile, reset]);

  // Load all users when admin opens user management
  useEffect(() => {
    if (user && showUserManagement && ['admin', 'system'].includes(userProfile?.role)) {
      loadAllUsers();
    }
  }, [user, showUserManagement, userProfile?.role, loadAllUsers]);

  return children;
}

export function useWorkspace() {
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const pendingSharedLink = useWorkspaceStore((s) => s.pendingSharedLink);
  const consumePendingSharedLink = useWorkspaceStore((s) => s.consumePendingSharedLink);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspaceMembers = useWorkspaceStore((s) => s.workspaceMembers);
  const showWorkspaceSettings = useWorkspaceStore((s) => s.showWorkspaceSettings);
  const setShowWorkspaceSettings = useWorkspaceStore((s) => s.setShowWorkspaceSettings);
  const showUserManagement = useWorkspaceStore((s) => s.showUserManagement);
  const setShowUserManagement = useWorkspaceStore((s) => s.setShowUserManagement);
  const userProfile = useWorkspaceStore((s) => s.userProfile);
  const allUsers = useWorkspaceStore((s) => s.allUsers);
  const allWorkspaces = useWorkspaceStore((s) => s.allWorkspaces);
  const workspacesLoading = useWorkspaceStore((s) => s.workspacesLoading);
  const usersLoading = useWorkspaceStore((s) => s.usersLoading);
  const workspaceBootstrapComplete = useWorkspaceStore((s) => s.workspaceBootstrapComplete);
  const handleWorkspaceChange = useWorkspaceStore((s) => s.handleWorkspaceChange);
  const handleCreateWorkspace = useWorkspaceStore((s) => s.handleCreateWorkspace);
  const handleOpenWorkspaceSettings = useWorkspaceStore((s) => s.handleOpenWorkspaceSettings);
  const handleUpdateWorkspace = useWorkspaceStore((s) => s.handleUpdateWorkspace);
  const handleAddWorkspaceMember = useWorkspaceStore((s) => s.handleAddWorkspaceMember);
  const handleRemoveWorkspaceMember = useWorkspaceStore((s) => s.handleRemoveWorkspaceMember);
  const handleDeleteWorkspace = useWorkspaceStore((s) => s.handleDeleteWorkspace);
  const handleInviteUser = useWorkspaceStore((s) => s.handleInviteUser);
  const handleUpdateUser = useWorkspaceStore((s) => s.handleUpdateUser);
  const handleUpdateUserWorkspaces = useWorkspaceStore((s) => s.handleUpdateUserWorkspaces);
  const handleDeleteUser = useWorkspaceStore((s) => s.handleDeleteUser);

  return {
    activeWorkspace,
    setActiveWorkspace,
    pendingSharedLink,
    consumePendingSharedLink,
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
