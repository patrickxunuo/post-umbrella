// Supabase Data Provider — barrel file
// Re-exports all domain modules. External imports remain unchanged:
//   import * as data from '../data/index.js';

export { setAuthToken, getCurrentUser, setCurrentUser, checkAuth } from './helpers.js';
export { checkEmailAllowed, sendMagicLink, signInWithSlack, login, logout, getDesktopDeepLink, onAuthStateChange } from './auth.js';
export { getCollections, createCollection, updateCollection, deleteCollection, getCollectionTree } from './collections.js';
export { getRequests, getRequest, createRequest, updateRequest, deleteRequest, reorderRequests, moveRequest, reorderCollections, moveCollection, reorderExamples } from './requests.js';
export { getExamples, getExample, createExample, updateExample, deleteExample } from './examples.js';
export { getEnvironments, createEnvironment, updateEnvironment, updateCurrentValues, activateEnvironment, deactivateEnvironments, deleteEnvironment } from './environments.js';
export { sendRequest } from './proxy.js';
export { exportCollection, importCollection, subscribeToChanges } from './sync.js';
export { getUserProfile, getAllUsers, updateUserProfile, deleteUser, activateUser, inviteUser, getUserWorkspaces, updateUserWorkspaces, getWorkspaces, getAllWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace, getWorkspaceMembers, getWorkspaceMembersMinimal, addWorkspaceMember, removeWorkspaceMember, getActiveWorkspace, setActiveWorkspace, getUserRole, canEdit, isAdmin, isMemberOf, updateLastSeen, joinWorkspacePresence, trackPresence, leaveWorkspacePresence, getPresenceChannel, getUserConfig, updateUserConfig } from './users.js';
export { getCollection, getCollectionVariables, saveCollectionVariables, updateCollectionVariableCurrentValues, getCollectionRequestCount } from './collectionVars.js';
export { getWorkflows, getWorkflow, createWorkflow, updateWorkflow, deleteWorkflow } from './workflows.js';

// Provider info
export const providerName = 'supabase';
export const supportsRealtime = true;
export const supportsMagicLink = true;
export const supportsWorkspaces = true;
export const supportsPresence = true;
