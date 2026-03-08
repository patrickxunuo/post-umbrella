// Express Backend Data Provider
// This wraps the existing API client to match the data layer interface

import * as api from '../../api/client.js';

// Re-export auth helpers
export const setAuthToken = api.setAuthToken;
export const getCurrentUser = api.getCurrentUser;
export const setCurrentUser = api.setCurrentUser;

// Auth
export const login = api.login;
export const logout = api.logout;
export const checkAuth = api.checkAuth;

// Magic link auth (not supported by Express backend - falls back to password)
export const sendMagicLink = async (email) => {
  throw new Error('Magic link auth not supported with Express backend. Please use email/password.');
};
export const verifyMagicLink = async (token) => {
  throw new Error('Magic link auth not supported with Express backend.');
};

// Bitbucket OAuth (not supported by Express backend)
export const signInWithBitbucket = async () => {
  throw new Error('Bitbucket OAuth not supported with Express backend.');
};

// Collections
export const getCollections = api.getCollections;
export const createCollection = api.createCollection;
export const updateCollection = api.updateCollection;
export const deleteCollection = api.deleteCollection;

// Requests
export const getRequests = api.getRequests;
export const getRequest = api.getRequest;
export const createRequest = api.createRequest;
export const updateRequest = api.updateRequest;
export const deleteRequest = api.deleteRequest;
export const reorderRequests = api.reorderRequests;
export const moveRequest = api.moveRequest;

// Examples
export const getExamples = api.getExamples;
export const getExample = api.getExample;
export const createExample = api.createExample;
export const updateExample = api.updateExample;
export const deleteExample = api.deleteExample;

// Environments
export const getEnvironments = api.getEnvironments;
export const getActiveEnvironment = api.getActiveEnvironment;
export const createEnvironment = api.createEnvironment;
export const updateEnvironment = api.updateEnvironment;
export const activateEnvironment = api.activateEnvironment;
export const deactivateEnvironments = api.deactivateEnvironments;
export const deleteEnvironment = api.deleteEnvironment;

// Proxy
export const sendRequest = api.sendRequest;

// Import/Export
export const exportCollections = api.exportCollections;
export const exportCollection = api.exportCollection;
export const importCollection = api.importCollection;

// Realtime - Express uses WebSocket
export const subscribeToChanges = (callback) => {
  // Returns unsubscribe function
  // The actual WebSocket logic is in useWebSocket hook
  // This is a placeholder for interface compatibility
  return () => {};
};

// Provider info
export const providerName = 'express';
export const supportsRealtime = true;
export const supportsMagicLink = false;
