import { useState, useEffect, useCallback, useRef } from 'react';
import { Umbrella, Settings, Terminal, AlertTriangle, X, Shield } from 'lucide-react';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { ImportExport } from './components/ImportExport';
import { EnvironmentEditor } from './components/EnvironmentEditor';
import { EnvironmentSelector } from './components/EnvironmentSelector';
import { WorkspaceSelector } from './components/WorkspaceSelector';
import { WorkspaceSettings } from './components/WorkspaceSettings';
import { UserManagement } from './components/UserManagement';
import { ImportCurlModal } from './components/ImportCurlModal';
import { ThemeToggle } from './components/ThemeToggle';
import { useToast } from './components/Toast';
import { useConfirm } from './components/ConfirmModal';
import { usePrompt } from './components/PromptModal';
import { useWebSocket } from './hooks/useWebSocket';
import { executeScript, applyEnvironmentUpdates } from './utils/scriptRunner';
import * as data from './data/index.js';
import './App.css';

const METHOD_COLORS = {
  GET: '#10b981',
  POST: '#f59e0b',
  PUT: '#3b82f6',
  PATCH: '#8b5cf6',
  DELETE: '#ef4444',
  HEAD: '#06b6d4',
  OPTIONS: '#64748b',
};

function App() {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'light';
  });
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [collections, setCollections] = useState([]);
  const [openTabs, setOpenTabs] = useState(() => {
    const saved = localStorage.getItem('openTabs');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeTabId, setActiveTabId] = useState(() => {
    return localStorage.getItem('activeTabId') || null;
  });
  const [conflictedTabs, setConflictedTabs] = useState({});
  const [deletedTabs, setDeletedTabs] = useState(new Set()); // Track tabs whose requests were deleted
  const [previewTabId, setPreviewTabId] = useState(null); // Track the "preview" tab that can be replaced
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingSaveTabId, setPendingSaveTabId] = useState(null);
  const recentlyModifiedRef = useRef(new Map()); // Track requests we just saved/renamed with timestamps

  // Helper to mark a tab as recently modified (prevents false conflict detection)
  const markAsRecentlyModified = useCallback((tabId) => {
    recentlyModifiedRef.current.set(tabId, Date.now());
    // Clean up old entries after 5 seconds
    setTimeout(() => {
      recentlyModifiedRef.current.delete(tabId);
    }, 5000);
  }, []);

  // Helper to check if a tab was recently modified by us
  const wasRecentlyModified = useCallback((tabId) => {
    const timestamp = recentlyModifiedRef.current.get(tabId);
    if (!timestamp) return false;
    // Consider it "recent" if within last 5 seconds
    return Date.now() - timestamp < 5000;
  }, []);

  const [examples, setExamples] = useState([]);
  const [loading, setLoading] = useState(false);
  const [environments, setEnvironments] = useState([]);
  const [activeEnvironment, setActiveEnvironment] = useState(null);
  const [currentRootCollectionId, setCurrentRootCollectionId] = useState(null);
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [showImportCurl, setShowImportCurl] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [allWorkspaces, setAllWorkspaces] = useState([]);
  const [draggingTabId, setDraggingTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return parseInt(localStorage.getItem('sidebarWidth')) || 280;
  });
  const [requestEditorHeight, setRequestEditorHeight] = useState(() => {
    return parseInt(localStorage.getItem('requestEditorHeight')) || 350;
  });
  const isResizing = useRef(false);
  const isResizingVertical = useRef(false);
  const mainContentRef = useRef(null);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Persist open tabs to localStorage (exclude temporary tabs)
  useEffect(() => {
    const persistentTabs = openTabs.filter(t => !t.isTemporary);
    localStorage.setItem('openTabs', JSON.stringify(persistentTabs));
  }, [openTabs]);

  // Persist active tab to localStorage (skip temporary tabs)
  useEffect(() => {
    if (activeTabId) {
      const activeTab = openTabs.find(t => t.id === activeTabId);
      // Only persist if it's not a temporary tab
      if (!activeTab?.isTemporary) {
        localStorage.setItem('activeTabId', activeTabId);
      }
    }
  }, [activeTabId, openTabs]);

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
  };

  // Sidebar resize handlers
  const startResizing = useCallback((e) => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Vertical resize handlers (request/response)
  const startResizingVertical = useCallback((e) => {
    isResizingVertical.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizing.current) {
        const newWidth = Math.max(200, Math.min(e.clientX, 500));
        setSidebarWidth(newWidth);
        localStorage.setItem('sidebarWidth', newWidth);
      }
      if (isResizingVertical.current && mainContentRef.current) {
        const rect = mainContentRef.current.getBoundingClientRect();
        const tabsBarHeight = 42; // Height of the tabs bar
        const minRequestHeight = 300; // Minimum height for request editor
        const minResponseHeight = 300; // Minimum height for response viewer
        const newHeight = e.clientY - rect.top - tabsBarHeight;
        const clampedHeight = Math.max(minRequestHeight, Math.min(newHeight, rect.height - minResponseHeight));
        setRequestEditorHeight(clampedHeight);
        localStorage.setItem('requestEditorHeight', clampedHeight);
      }
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      isResizingVertical.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const activeTab = openTabs.find(t => t.id === activeTabId);
  const selectedRequest = activeTab?.type === 'request' ? activeTab?.request : null;
  const selectedExample = activeTab?.type === 'example' ? activeTab?.example : null;
  const response = activeTab?.response || null;

  const originalRequestsRef = useRef({});

  // Initialize originalRequestsRef for tabs restored from localStorage
  useEffect(() => {
    openTabs.forEach(tab => {
      if (!originalRequestsRef.current[tab.id]) {
        if (tab.type === 'request' && tab.request) {
          originalRequestsRef.current[tab.id] = JSON.stringify({
            method: tab.request.method,
            url: tab.request.url,
            headers: tab.request.headers,
            body: tab.request.body,
            body_type: tab.request.body_type,
            form_data: tab.request.form_data,
            auth_type: tab.request.auth_type,
            auth_token: tab.request.auth_token,
            pre_script: tab.request.pre_script,
            post_script: tab.request.post_script,
          });
        } else if (tab.type === 'example' && tab.example) {
          originalRequestsRef.current[tab.id] = JSON.stringify({
            name: tab.example.name,
            request_data: tab.example.request_data,
            response_data: tab.example.response_data,
          });
        }
      }
    });
  }, []); // Run once on mount

  // Check auth on page load
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        // Always check with the backend/Supabase for valid session
        const validUser = await data.checkAuth();
        setUser(validUser);
      } catch (err) {
        // Not authenticated or token expired
        setUser(null);
      }
      setAuthChecked(true);
    };
    verifyAuth();
  }, []);

  // Handle logout events
  useEffect(() => {
    const handleLogout = () => setUser(null);
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  // Load collections on mount (after login)
  // Load workspaces
  const loadWorkspaces = useCallback(async () => {
    if (!user) return;
    try {
      const workspaces = await data.getWorkspaces();
      setWorkspaces(workspaces);

      // If no active workspace, load it
      if (!activeWorkspace) {
        const active = await data.getActiveWorkspace();
        setActiveWorkspace(active);
      }
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    }
  }, [user, activeWorkspace]);

  // Load user profile
  const loadUserProfile = useCallback(async () => {
    if (!user) return;
    try {
      const profile = await data.getUserProfile();
      setUserProfile(profile);
    } catch (err) {
      console.error('Failed to load user profile:', err);
    }
  }, [user]);

  // Load all users (admin only)
  const loadAllUsers = useCallback(async () => {
    if (!userProfile || userProfile.role !== 'admin') return;
    try {
      const users = await data.getAllUsers();
      const workspaces = await data.getAllWorkspaces();
      setAllWorkspaces(workspaces);

      // Enrich users with their workspaces
      const enrichedUsers = await Promise.all(
        users.map(async (user) => {
          const userWorkspaces = await data.getUserWorkspaces(user.user_id);
          return { ...user, workspaces: userWorkspaces };
        })
      );
      setAllUsers(enrichedUsers);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }, [userProfile]);

  // Handle workspace change
  const handleWorkspaceChange = useCallback(async (workspace) => {
    try {
      await data.setActiveWorkspace(workspace.id);
      setActiveWorkspace(workspace);
      // Clear current tabs and reload collections for new workspace
      setOpenTabs([]);
      setActiveTabId(null);
      setActiveEnvironment(null);
      setCurrentRootCollectionId(null);
    } catch (err) {
      toast.error('Failed to switch workspace');
    }
  }, [toast]);

  // Handle create workspace
  const handleCreateWorkspace = useCallback(async () => {
    const name = await prompt({
      title: 'Create Workspace',
      message: 'Enter a name for the new workspace:',
      placeholder: 'Workspace name',
    });
    if (!name) return;

    try {
      const workspace = await data.createWorkspace(name);
      setWorkspaces(prev => [...prev, workspace]);
      // Switch to the new workspace
      await handleWorkspaceChange(workspace);
      toast.success(`Workspace "${name}" created`);
    } catch (err) {
      toast.error(err.message || 'Failed to create workspace');
    }
  }, [prompt, toast, handleWorkspaceChange]);

  // Load workspace members for settings modal
  const loadWorkspaceMembers = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const members = await data.getWorkspaceMembers(activeWorkspace.id);
      setWorkspaceMembers(members);
    } catch (err) {
      console.error('Failed to load workspace members:', err);
    }
  }, [activeWorkspace]);

  // Open workspace settings modal
  const handleOpenWorkspaceSettings = useCallback(async () => {
    await loadWorkspaceMembers();
    setShowWorkspaceSettings(true);
  }, [loadWorkspaceMembers]);

  // Workspace settings handlers
  const handleUpdateWorkspace = useCallback(async (workspaceId, updates) => {
    try {
      const updated = await data.updateWorkspace(workspaceId, updates);
      setActiveWorkspace(prev => prev ? { ...prev, ...updated } : null);
      setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, ...updated } : w));
      toast.success('Workspace updated');
    } catch (err) {
      toast.error(err.message || 'Failed to update workspace');
    }
  }, [toast]);

  const handleAddWorkspaceMember = useCallback(async (workspaceId, email) => {
    try {
      await data.addWorkspaceMember(workspaceId, email);
      await loadWorkspaceMembers();
      toast.success(`Added ${email} to workspace`);
    } catch (err) {
      toast.error(err.message || 'Failed to add member');
    }
  }, [toast, loadWorkspaceMembers]);

  const handleRemoveWorkspaceMember = useCallback(async (workspaceId, userId) => {
    try {
      await data.removeWorkspaceMember(workspaceId, userId);
      await loadWorkspaceMembers();
      toast.success('Member removed');
    } catch (err) {
      toast.error(err.message || 'Failed to remove member');
    }
  }, [toast, loadWorkspaceMembers]);

  const handleDeleteWorkspace = useCallback(async (workspaceId) => {
    try {
      await data.deleteWorkspace(workspaceId);
      setWorkspaces(prev => prev.filter(w => w.id !== workspaceId));
      // Switch to another workspace if available
      const remaining = workspaces.filter(w => w.id !== workspaceId);
      if (remaining.length > 0) {
        await handleWorkspaceChange(remaining[0]);
      } else {
        setActiveWorkspace(null);
        setCollections([]);
      }
      setShowWorkspaceSettings(false);
      toast.success('Workspace deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete workspace');
    }
  }, [toast, workspaces, handleWorkspaceChange]);

  const loadCollections = useCallback(async () => {
    if (!user) return;
    try {
      const workspaceId = activeWorkspace?.id || null;
      const collections = await data.getCollections(workspaceId);
      setCollections(collections);
    } catch (err) {
      console.error('Failed to load collections:', err);
    }
  }, [user, activeWorkspace]);

  // Helper to find the root collection ID (the top-level collection in the hierarchy)
  const getRootCollectionId = useCallback((collectionId) => {
    if (!collectionId || collections.length === 0) return null;

    let currentId = collectionId;
    let iterations = 0;
    const maxIterations = 100; // Prevent infinite loops

    while (iterations < maxIterations) {
      const collection = collections.find(c => c.id === currentId);
      if (!collection) return null;
      if (!collection.parent_id) return currentId; // Found the root
      currentId = collection.parent_id;
      iterations++;
    }

    return null;
  }, [collections]);

  const loadEnvironments = useCallback(async (collectionId) => {
    if (!user || !collectionId) {
      setEnvironments([]);
      setActiveEnvironment(null);
      return;
    }
    try {
      const envs = await data.getEnvironments(collectionId);
      setEnvironments(envs);
      const active = envs.find(e => e.is_active);
      setActiveEnvironment(active || null);
    } catch (err) {
      console.error('Failed to load environments:', err);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      // Load workspaces first, which will set the active workspace
      loadWorkspaces();
      // Load user profile for role-based access
      loadUserProfile();
    }
  }, [user, loadWorkspaces, loadUserProfile]);

  // Load all users when user management is opened (admin only)
  useEffect(() => {
    if (showUserManagement && userProfile?.role === 'admin') {
      loadAllUsers();
    }
  }, [showUserManagement, userProfile?.role, loadAllUsers]);

  // Load collections when active workspace changes
  useEffect(() => {
    if (user && activeWorkspace) {
      loadCollections();
      // Environments are loaded when a request is selected (they're collection-specific)
    }
  }, [user, activeWorkspace, loadCollections]);

  // Load examples when request is selected
  useEffect(() => {
    if (selectedRequest?.id && user) {
      data.getExamples(selectedRequest.id).then(setExamples);
    } else {
      setExamples([]);
    }
  }, [selectedRequest?.id, user]);

  // Update current root collection and load environments when selected request/example changes
  useEffect(() => {
    let collectionId = null;

    if (selectedRequest?.collection_id) {
      collectionId = selectedRequest.collection_id;
    } else if (selectedExample) {
      // For examples, find collection through parent request
      const parentRequestId = activeTab?.parentRequestId || selectedExample.request_id;
      if (parentRequestId && collections.length > 0) {
        // Search through collections to find the request
        for (const coll of collections) {
          const foundReq = coll.requests?.find(r => r.id === parentRequestId);
          if (foundReq) {
            collectionId = foundReq.collection_id;
            break;
          }
        }
      }
    }

    if (collectionId && collections.length > 0) {
      const rootId = getRootCollectionId(collectionId);
      if (rootId !== currentRootCollectionId) {
        setCurrentRootCollectionId(rootId);
        loadEnvironments(rootId);
      }
    } else if (!selectedRequest && !selectedExample) {
      // Nothing selected - clear environments
      setCurrentRootCollectionId(null);
      setEnvironments([]);
      setActiveEnvironment(null);
    }
  }, [selectedRequest?.collection_id, selectedExample, activeTab?.parentRequestId, collections, getRootCollectionId, currentRootCollectionId, loadEnvironments]);

  // Refs for keyboard handler to access latest state without stale closures
  const saveStateRef = useRef({ activeTab, selectedRequest, selectedExample });
  useEffect(() => {
    saveStateRef.current = { activeTab, selectedRequest, selectedExample };
  }, [activeTab, selectedRequest, selectedExample]);

  // Ref for save functions
  const saveFunctionsRef = useRef({ handleSaveRequest: null, handleSaveExample: null });

  // Ctrl+S keyboard shortcut for saving
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const { activeTab, selectedRequest, selectedExample } = saveStateRef.current;
        const { handleSaveRequest, handleSaveExample } = saveFunctionsRef.current;

        // Only save if there are changes
        if (activeTab?.dirty) {
          if (activeTab?.type === 'example' && selectedExample && handleSaveExample) {
            // Save example
            handleSaveExample({
              name: selectedExample.name,
              request_data: selectedExample.request_data,
              response_data: selectedExample.response_data,
            });
          } else if (selectedRequest && !activeTab?.isTemporary && handleSaveRequest) {
            // Save request (not temporary)
            handleSaveRequest({
              method: selectedRequest.method,
              url: selectedRequest.url,
              headers: selectedRequest.headers,
              body: selectedRequest.body,
              body_type: selectedRequest.body_type,
              auth_type: selectedRequest.auth_type,
              auth_token: selectedRequest.auth_token,
              params: selectedRequest.params,
              pre_script: selectedRequest.pre_script,
              post_script: selectedRequest.post_script,
            });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // Only run once on mount

  // WebSocket handler for sync
  const handleWebSocketMessage = useCallback(
    (message) => {
      const { event, data: payload } = message;

      if (event === 'request:update' && payload?.id) {
        const tabId = `request-${payload.id}`;
        // Check if this is our own save or rename (ignore it)
        if (wasRecentlyModified(tabId)) {
          loadCollections();
          return;
        }

        // Check if this request is open in any tab (means user is working on it)
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          // Mark as conflicted - someone else updated while we have it open
          setConflictedTabs(prev => ({
            ...prev,
            [tabId]: payload
          }));
          // Still update collections for sidebar display
          loadCollections();
          return;
        }
      }

      if (event === 'example:update' && payload?.id) {
        const tabId = `example-${payload.id}`;
        // Check if this is our own save or rename (ignore it)
        if (wasRecentlyModified(tabId)) {
          loadCollections();
          return;
        }

        // Check if this example is open in any tab
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          setConflictedTabs(prev => ({
            ...prev,
            [tabId]: payload
          }));
          loadCollections();
          return;
        }
      }

      // Handle request deletion - mark open tabs as deleted
      if (event === 'request:delete' && payload?.id) {
        const tabId = `request-${payload.id}`;
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          setDeletedTabs(prev => new Set([...prev, tabId]));
        }
      }

      // Handle example deletion - mark open tabs as deleted
      if (event === 'example:delete' && payload?.id) {
        const tabId = `example-${payload.id}`;
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          setDeletedTabs(prev => new Set([...prev, tabId]));
        }
      }

      if (
        event === 'collection:create' ||
        event === 'collection:update' ||
        event === 'collection:delete' ||
        event === 'request:create' ||
        event === 'request:update' ||
        event === 'request:delete' ||
        event === 'request:reorder' ||
        event === 'request:move' ||
        event === 'example:create' ||
        event === 'example:update' ||
        event === 'example:delete' ||
        event === 'sync:import'
      ) {
        loadCollections();
        // After import, environments will be loaded when user selects a request
      }

      if (
        event === 'example:create' ||
        event === 'example:update' ||
        event === 'example:delete'
      ) {
        if (selectedRequest?.id) {
          data.getExamples(selectedRequest.id).then(setExamples);
        }
      }

      if (
        event === 'environment:create' ||
        event === 'environment:update' ||
        event === 'environment:delete' ||
        event === 'environment:activate' ||
        event === 'environment:deactivate'
      ) {
        if (currentRootCollectionId) {
          loadEnvironments(currentRootCollectionId);
        }
      }
    },
    [loadCollections, loadEnvironments, selectedRequest?.id, openTabs, wasRecentlyModified, currentRootCollectionId]
  );

  useWebSocket(handleWebSocketMessage);

  // Handlers
  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    await data.logout();
    setUser(null);
    setUserProfile(null);
    setCollections([]);
    setOpenTabs([]);
    setActiveTabId(null);
    setExamples([]);
    setEnvironments([]);
    setActiveEnvironment(null);
  };

  // User management handlers
  const handleInviteUser = async (email, role, workspaceIds) => {
    try {
      await data.inviteUser(email, role, workspaceIds);
      toast.success(`Invitation sent to ${email}`);
      loadAllUsers();
    } catch (err) {
      toast.error(err.message || 'Failed to invite user');
    }
  };

  const handleUpdateUser = async (userId, updates) => {
    try {
      await data.updateUserProfile(userId, updates);
      toast.success('User updated');
      loadAllUsers();
    } catch (err) {
      toast.error(err.message || 'Failed to update user');
    }
  };

  const handleUpdateUserWorkspaces = async (userId, workspaceIds) => {
    try {
      await data.updateUserWorkspaces(userId, workspaceIds);
      toast.success('User workspaces updated');
      loadAllUsers();
    } catch (err) {
      toast.error(err.message || 'Failed to update user workspaces');
    }
  };

  const handleCreateCollection = async () => {
    const name = await prompt({
      title: 'New Collection',
      message: 'Enter a name for the new collection:',
      defaultValue: 'New Collection',
      placeholder: 'Collection name',
    });
    if (name) {
      try {
        await data.createCollection({ name, workspace_id: activeWorkspace?.id });
      } catch (err) {
        toast.error(err.message || 'Failed to create collection');
      }
    }
  };

  const handleCreateSubCollection = async (parentId) => {
    const name = await prompt({
      title: 'New Folder',
      message: 'Enter a name for the new folder:',
      defaultValue: 'New Folder',
      placeholder: 'Folder name',
    });
    if (name) {
      try {
        await data.createCollection({ name, parent_id: parentId });
      } catch (err) {
        toast.error(err.message || 'Failed to create folder');
      }
    }
  };

  const handleCreateRequest = async (collectionId) => {
    try {
      const request = await data.createRequest({
        collection_id: collectionId,
        name: 'New Request',
      });
      openRequestInTab(request);
    } catch (err) {
      toast.error(err.message || 'Failed to create request');
    }
  };

  const handleDeleteCollection = async (id) => {
    try {
      await data.deleteCollection(id);
      setOpenTabs(prev => prev.filter(t => t.type !== 'request' || t.request?.collection_id !== id));
    } catch (err) {
      toast.error(err.message || 'Failed to delete collection');
    }
  };

  const handleDeleteRequest = async (id) => {
    try {
      await data.deleteRequest(id);
      closeTab(`request-${id}`);
      // Also close any example tabs for this request
      setOpenTabs(prev => prev.filter(t => t.type !== 'example' || t.parentRequestId !== id));
    } catch (err) {
      toast.error(err.message || 'Failed to delete request');
    }
  };

  const handleDuplicateRequest = async (request) => {
    const duplicatedRequest = await data.createRequest({
      collection_id: request.collection_id,
      name: `${request.name} (Copy)`,
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      body_type: request.body_type,
      auth_type: request.auth_type,
      auth_token: request.auth_token,
    });
    openRequestInTab(duplicatedRequest);
  };

  const handleMoveRequest = async (requestId, targetCollectionId) => {
    try {
      await data.moveRequest(requestId, targetCollectionId);
      // Update the open tab's collection_id if it's open
      const tabId = `request-${requestId}`;
      setOpenTabs(prev => prev.map(t =>
        t.id === tabId ? { ...t, request: { ...t.request, collection_id: targetCollectionId } } : t
      ));
      toast.success('Request moved successfully');
    } catch (err) {
      toast.error(err.message || 'Failed to move request');
    }
  };

  const handleRenameCollection = async (id, name) => {
    await data.updateCollection(id, { name });
  };

  const handleRenameRequest = async (id, name) => {
    const tabId = `request-${id}`;
    // Mark as recently modified so we don't treat our own update as a conflict
    markAsRecentlyModified(tabId);
    await data.updateRequest(id, { name });
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, request: { ...t.request, name } } : t
    ));
  };

  // Example handlers
  const handleCreateExample = async (requestId) => {
    const example = await data.createExample({
      request_id: requestId,
      name: 'New Example',
      request_data: { method: 'GET', url: '', headers: [], body: '' },
      response_data: { status: 200, body: '', headers: [] },
    });
    openExampleInTab(example, { id: requestId });
  };

  const handleDeleteExample = async (id) => {
    await data.deleteExample(id);
    closeTab(`example-${id}`);
  };

  const handleDuplicateExample = async (example) => {
    const duplicated = await data.createExample({
      request_id: example.request_id,
      name: `${example.name} (Copy)`,
      request_data: example.request_data,
      response_data: example.response_data,
    });
    openExampleInTab(duplicated, { id: example.request_id });
  };

  // Save current request state as a new example
  const handleSaveAsExample = async (exampleName, requestData, responseData) => {
    if (!selectedRequest?.id) return;

    const example = await data.createExample({
      request_id: selectedRequest.id,
      name: exampleName || 'New Example',
      request_data: requestData,
      response_data: responseData,
    });
    openExampleInTab(example, selectedRequest);
  };

  const handleRenameExample = async (id, name) => {
    const tabId = `example-${id}`;
    // Mark as recently modified so we don't treat our own update as a conflict
    markAsRecentlyModified(tabId);
    await data.updateExample(id, { name });
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, example: { ...t.example, name } } : t
    ));
  };

  // Conflict resolution handlers
  const handleOverwriteConflict = async () => {
    if (!pendingSaveTabId) return;
    const tab = openTabs.find(t => t.id === pendingSaveTabId);
    if (!tab) return;

    const isDeleted = deletedTabs.has(pendingSaveTabId);

    if (isDeleted) {
      // For deleted items, create a new one instead of updating
      // First, remove the old tab directly (skip dirty check since user chose to save)
      setOpenTabs(prev => prev.filter(t => t.id !== pendingSaveTabId));
      delete originalRequestsRef.current[pendingSaveTabId];
      setDeletedTabs(prev => {
        const next = new Set(prev);
        next.delete(pendingSaveTabId);
        return next;
      });

      if (tab.type === 'example') {
        const newExample = await data.createExample({
          request_id: tab.parentRequestId,
          name: tab.example.name,
          request_data: tab.example.request_data,
          response_data: tab.example.response_data,
        });
        openExampleInTab(newExample, { id: tab.parentRequestId });
      } else {
        const newRequest = await data.createRequest({
          collection_id: tab.request.collection_id,
          name: tab.request.name,
          method: tab.request.method,
          url: tab.request.url,
          headers: tab.request.headers,
          body: tab.request.body,
          body_type: tab.request.body_type,
          auth_type: tab.request.auth_type,
          auth_token: tab.request.auth_token,
          params: tab.request.params,
          form_data: tab.request.form_data,
        });
        openRequestInTab(newRequest);
      }
    } else {
      // Normal conflict - overwrite
      if (tab.type === 'example') {
        await doSaveExample({
          name: tab.example.name,
          request_data: tab.example.request_data,
          response_data: tab.example.response_data,
        }, pendingSaveTabId);
      } else {
        await doSaveRequest({
          method: tab.request.method,
          url: tab.request.url,
          headers: tab.request.headers,
          body: tab.request.body,
          body_type: tab.request.body_type,
          auth_type: tab.request.auth_type,
          auth_token: tab.request.auth_token,
        }, pendingSaveTabId);
      }
    }
    setShowConflictModal(false);
    setPendingSaveTabId(null);
  };

  const handleDiscardChanges = () => {
    if (!pendingSaveTabId) return;
    const tab = openTabs.find(t => t.id === pendingSaveTabId);
    const isDeleted = deletedTabs.has(pendingSaveTabId);

    if (isDeleted) {
      // For deleted items, discard means close the tab directly (skip dirty check)
      setOpenTabs(prev => {
        const newTabs = prev.filter(t => t.id !== pendingSaveTabId);
        if (activeTabId === pendingSaveTabId && newTabs.length > 0) {
          setActiveTabId(newTabs[newTabs.length - 1].id);
        } else if (newTabs.length === 0) {
          setActiveTabId(null);
        }
        return newTabs;
      });
      delete originalRequestsRef.current[pendingSaveTabId];
      setDeletedTabs(prev => {
        const next = new Set(prev);
        next.delete(pendingSaveTabId);
        return next;
      });
    } else {
      // Normal conflict - load server version
      const serverData = conflictedTabs[pendingSaveTabId];
      if (serverData && tab) {
        if (tab.type === 'example') {
          // Load the server version for example
          setOpenTabs(prev => prev.map(t =>
            t.id === pendingSaveTabId
              ? { ...t, example: { ...t.example, ...serverData }, dirty: false }
              : t
          ));
          originalRequestsRef.current[pendingSaveTabId] = JSON.stringify({
            name: serverData.name,
            request_data: serverData.request_data,
            response_data: serverData.response_data,
          });
        } else {
          // Load the server version for request
          setOpenTabs(prev => prev.map(t =>
            t.id === pendingSaveTabId
              ? { ...t, request: { ...t.request, ...serverData }, dirty: false }
              : t
          ));
          originalRequestsRef.current[pendingSaveTabId] = JSON.stringify({
            method: serverData.method,
            url: serverData.url,
            headers: serverData.headers,
            body: serverData.body,
            body_type: serverData.body_type,
            auth_type: serverData.auth_type,
            auth_token: serverData.auth_token,
          });
        }
        // Clear conflict
        setConflictedTabs(prev => {
          const next = { ...prev };
          delete next[pendingSaveTabId];
          return next;
        });
      }
    }
    setShowConflictModal(false);
    setPendingSaveTabId(null);
  };

  // Tab drag handlers
  const handleTabDragStart = (e, tabId) => {
    setDraggingTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleTabDragEnd = () => {
    setDraggingTabId(null);
    setDragOverTabId(null);
  };

  const handleTabDragOver = (e, tabId) => {
    e.preventDefault();
    if (draggingTabId && draggingTabId !== tabId) {
      setDragOverTabId(tabId);
    }
  };

  const handleTabDrop = (e, targetTabId) => {
    e.preventDefault();
    if (!draggingTabId || draggingTabId === targetTabId) return;

    setOpenTabs(prev => {
      const tabs = [...prev];
      const dragIndex = tabs.findIndex(t => t.id === draggingTabId);
      const dropIndex = tabs.findIndex(t => t.id === targetTabId);

      const [draggedTab] = tabs.splice(dragIndex, 1);
      tabs.splice(dropIndex, 0, draggedTab);

      return tabs;
    });

    setDraggingTabId(null);
    setDragOverTabId(null);
  };

  const openRequestInTab = async (request) => {
    const tabId = `request-${request.id}`;
    const existingTab = openTabs.find(t => t.id === tabId);
    if (existingTab) {
      setActiveTabId(tabId);
      return;
    }

    const fullRequest = await data.getRequest(request.id);

    originalRequestsRef.current[tabId] = JSON.stringify({
      method: fullRequest.method,
      url: fullRequest.url,
      headers: fullRequest.headers,
      body: fullRequest.body,
      body_type: fullRequest.body_type,
      form_data: fullRequest.form_data,
      auth_type: fullRequest.auth_type,
      auth_token: fullRequest.auth_token,
      pre_script: fullRequest.pre_script,
      post_script: fullRequest.post_script,
    });

    const hasBody = fullRequest.body_type && fullRequest.body_type !== 'none';
    const newTab = {
      id: tabId,
      type: 'request',
      entityId: request.id,
      request: fullRequest,
      dirty: false,
      response: null,
      activeDetailTab: hasBody ? 'body' : 'params',
    };

    setOpenTabs(prev => {
      // Find the preview tab (if it exists and is still clean)
      const previewTab = previewTabId ? prev.find(t => t.id === previewTabId) : null;

      // Replace preview tab if it exists, is not dirty, and not temporary
      if (previewTab && !previewTab.dirty && !previewTab.isTemporary) {
        // Clean up the old tab's original reference
        delete originalRequestsRef.current[previewTab.id];

        // Replace the preview tab with the new one
        return prev.map(t => t.id === previewTabId ? newTab : t);
      }

      // Otherwise add a new tab
      return [...prev, newTab];
    });
    setActiveTabId(tabId);
    setPreviewTabId(tabId); // Mark the new tab as the preview tab
  };

  const openExampleInTab = async (example, parentRequest) => {
    const tabId = `example-${example.id}`;
    const existingTab = openTabs.find(t => t.id === tabId);
    if (existingTab) {
      setActiveTabId(tabId);
      return;
    }

    const fullExample = await data.getExample(example.id);

    originalRequestsRef.current[tabId] = JSON.stringify({
      name: fullExample.name,
      request_data: fullExample.request_data,
      response_data: fullExample.response_data,
    });

    const reqData = fullExample.request_data || {};
    const hasBody = reqData.body_type && reqData.body_type !== 'none';
    const newTab = {
      id: tabId,
      type: 'example',
      entityId: example.id,
      parentRequestId: parentRequest?.id || fullExample.request_id,
      example: fullExample,
      dirty: false,
      activeDetailTab: hasBody ? 'body' : 'params',
    };

    setOpenTabs(prev => {
      // Find the preview tab (if it exists and is still clean)
      const previewTab = previewTabId ? prev.find(t => t.id === previewTabId) : null;

      // Replace preview tab if it exists, is not dirty, and not temporary
      if (previewTab && !previewTab.dirty && !previewTab.isTemporary) {
        // Clean up the old tab's original reference
        delete originalRequestsRef.current[previewTab.id];

        // Replace the preview tab with the new one
        return prev.map(t => t.id === previewTabId ? newTab : t);
      }

      // Otherwise add a new tab
      return [...prev, newTab];
    });
    setActiveTabId(tabId);
    setPreviewTabId(tabId); // Mark the new tab as the preview tab
  };

  const closeTab = async (id, e) => {
    if (e) e.stopPropagation();

    const tab = openTabs.find(t => t.id === id);
    if (tab?.dirty) {
      const confirmed = await confirm({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Are you sure you want to close this tab?',
        confirmText: 'Close',
        cancelText: 'Cancel',
        variant: 'danger',
      });
      if (!confirmed) return;
    }

    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.id !== id);
      if (activeTabId === id && newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });

    // Clear preview if this was the preview tab
    if (previewTabId === id) {
      setPreviewTabId(null);
    }

    delete originalRequestsRef.current[id];
  };

  const updateTabRequest = (updates) => {
    if (!activeTabId) return;

    setOpenTabs(prev => prev.map(t => {
      if (t.id !== activeTabId) return t;

      const newRequest = { ...t.request, ...updates };

      const current = JSON.stringify({
        method: newRequest.method,
        url: newRequest.url,
        headers: newRequest.headers,
        body: newRequest.body,
        body_type: newRequest.body_type,
        form_data: newRequest.form_data,
        auth_type: newRequest.auth_type,
        auth_token: newRequest.auth_token,
        pre_script: newRequest.pre_script,
        post_script: newRequest.post_script,
      });
      const original = originalRequestsRef.current[t.id];
      const dirty = current !== original;

      // Clear preview status if tab becomes dirty
      if (dirty && previewTabId === t.id) {
        setPreviewTabId(null);
      }

      return { ...t, request: newRequest, dirty };
    }));
  };

  const updateTabExample = (updates) => {
    if (!activeTabId) return;

    setOpenTabs(prev => prev.map(t => {
      if (t.id !== activeTabId) return t;

      const newExample = { ...t.example, ...updates };

      const current = JSON.stringify({
        name: newExample.name,
        request_data: newExample.request_data,
        response_data: newExample.response_data,
      });
      const original = originalRequestsRef.current[t.id];
      const dirty = current !== original;

      // Clear preview status if tab becomes dirty
      if (dirty && previewTabId === t.id) {
        setPreviewTabId(null);
      }

      return { ...t, example: newExample, dirty };
    }));
  };

  const updateActiveDetailTab = (tabName) => {
    if (!activeTabId) return;
    setOpenTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, activeDetailTab: tabName } : t
    ));
  };

  const handleSelectRequest = (request) => {
    openRequestInTab(request);
  };

  // Substitute environment variables in URL and headers
  const substituteVariables = (text) => {
    if (!text || !activeEnvironment) return text;

    let result = text;
    for (const v of activeEnvironment.variables) {
      if (v.enabled && v.key) {
        const regex = new RegExp(`\\{\\{${v.key}\\}\\}`, 'g');
        result = result.replace(regex, v.value);
      }
    }
    return result;
  };

  const handleSendRequest = async ({ method, url, headers, body, bodyType, formData, authType, authToken, preScript, postScript }) => {
    setLoading(true);
    let scriptLogs = [];
    let currentEnv = activeEnvironment;

    try {
      // Execute pre-script if present
      if (preScript) {
        const preResult = await executeScript(preScript, {
          environment: currentEnv,
          request: { method, url, headers, body },
        });

        scriptLogs.push(...preResult.logs);

        if (!preResult.success) {
          // Show pre-script error
          toast.error(`Pre-script error: ${preResult.errors[0]?.message || 'Unknown error'}`);
        }

        // Apply environment updates from pre-script
        if (Object.keys(preResult.envUpdates).length > 0 && currentEnv) {
          currentEnv = applyEnvironmentUpdates(currentEnv, preResult.envUpdates);
          // Persist environment changes
          await data.updateEnvironment(currentEnv.id, { variables: currentEnv.variables });
          setActiveEnvironment(currentEnv);
        }
      }

      // Substitute environment variables (use updated environment)
      const substituteWithEnv = (text) => {
        if (!text || !currentEnv) return text;
        let result = text;
        for (const v of currentEnv.variables) {
          if (v.enabled && v.key) {
            const regex = new RegExp(`\\{\\{${v.key}\\}\\}`, 'g');
            result = result.replace(regex, v.value);
          }
        }
        return result;
      };

      const resolvedUrl = substituteWithEnv(url);
      const resolvedHeaders = headers.map(h => ({
        ...h,
        key: substituteWithEnv(h.key),
        value: substituteWithEnv(h.value),
      }));
      const resolvedBody = substituteWithEnv(body);
      const resolvedAuthToken = substituteWithEnv(authToken);

      // Resolve environment variables in form-data text values
      const resolvedFormData = formData?.map(f => ({
        ...f,
        key: substituteWithEnv(f.key),
        value: f.type === 'file' ? f.value : substituteWithEnv(f.value),
      }));

      // Add Content-Type header for JSON body if not already set
      if (bodyType === 'json' && resolvedBody) {
        const hasContentType = resolvedHeaders.some(
          h => h.key.toLowerCase() === 'content-type' && h.enabled !== false
        );
        if (!hasContentType) {
          resolvedHeaders.push({
            key: 'Content-Type',
            value: 'application/json',
            enabled: true,
          });
        }
      }

      // Add Authorization header if using bearer auth
      if (authType === 'bearer' && resolvedAuthToken) {
        resolvedHeaders.push({
          key: 'Authorization',
          value: `Bearer ${resolvedAuthToken}`,
          enabled: true,
        });
      }

      // Build request payload
      const requestPayload = {
        method,
        url: resolvedUrl,
        headers: resolvedHeaders,
        bodyType,
      };

      if (bodyType === 'form-data') {
        requestPayload.formData = resolvedFormData?.filter(f => f.enabled !== false && f.key);
      } else if (bodyType !== 'none') {
        requestPayload.body = resolvedBody;
      }

      const result = await data.sendRequest(requestPayload);

      // Execute post-script if present
      if (postScript) {
        const postResult = await executeScript(postScript, {
          environment: currentEnv,
          response: result,
        });

        scriptLogs.push(...postResult.logs);

        if (!postResult.success) {
          toast.error(`Post-script error: ${postResult.errors[0]?.message || 'Unknown error'}`);
        }

        // Apply environment updates from post-script
        if (Object.keys(postResult.envUpdates).length > 0 && currentEnv) {
          currentEnv = applyEnvironmentUpdates(currentEnv, postResult.envUpdates);
          // Persist environment changes
          await data.updateEnvironment(currentEnv.id, { variables: currentEnv.variables });
          setActiveEnvironment(currentEnv);
          if (currentRootCollectionId) {
            loadEnvironments(currentRootCollectionId); // Refresh environment list
          }
        }
      }

      // Log script output to console (for debugging)
      if (scriptLogs.length > 0) {
        console.group('Script Output');
        scriptLogs.forEach(log => {
          console[log.type]?.(log.message) || console.log(log.message);
        });
        console.groupEnd();
      }

      setOpenTabs(prev => prev.map(t =>
        t.id === activeTabId ? { ...t, response: { ...result, scriptLogs } } : t
      ));
    } catch (error) {
      setOpenTabs(prev => prev.map(t =>
        t.id === activeTabId ? {
          ...t,
          response: {
            status: 0,
            statusText: 'Error',
            body: error.message,
            headers: [],
            time: 0,
            error: true,
            scriptLogs,
          }
        } : t
      ));
    } finally {
      setLoading(false);
    }
  };

  const doSaveRequest = async (requestData, tabId) => {
    if (!tabId) return;
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      // Mark as recently modified so we don't treat our own update as a conflict
      markAsRecentlyModified(tabId);

      const updated = await data.updateRequest(tab.entityId, requestData);

      // Preserve scripts in case API response doesn't include them
      const savedPreScript = updated.pre_script ?? requestData.pre_script ?? '';
      const savedPostScript = updated.post_script ?? requestData.post_script ?? '';

      originalRequestsRef.current[tabId] = JSON.stringify({
        method: updated.method,
        url: updated.url,
        headers: updated.headers,
        body: updated.body,
        body_type: updated.body_type,
        form_data: updated.form_data,
        auth_type: updated.auth_type,
        auth_token: updated.auth_token,
        pre_script: savedPreScript,
        post_script: savedPostScript,
      });

      setOpenTabs(prev => prev.map(t =>
        t.id === tabId ? {
          ...t,
          request: {
            ...updated,
            pre_script: savedPreScript,
            post_script: savedPostScript,
          },
          dirty: false
        } : t
      ));

      // Clear any existing conflict for this tab since we just saved
      setConflictedTabs(prev => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    } catch (err) {
      toast.error(err.message || 'Failed to save request');
    }
  };

  const doSaveExample = async (exampleData, tabId) => {
    if (!tabId) return;
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      // Mark as recently modified so we don't treat our own update as a conflict
      markAsRecentlyModified(tabId);

      const updated = await data.updateExample(tab.entityId, exampleData);

      originalRequestsRef.current[tabId] = JSON.stringify({
        name: updated.name,
        request_data: updated.request_data,
        response_data: updated.response_data,
      });

      setOpenTabs(prev => prev.map(t =>
        t.id === tabId ? { ...t, example: updated, dirty: false } : t
      ));

      // Clear any existing conflict for this tab since we just saved
      setConflictedTabs(prev => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    } catch (err) {
      toast.error(err.message || 'Failed to save example');
    }
  };

  const handleSaveRequest = useCallback(async (requestData) => {
    if (!activeTabId) return;

    // Check if there's a conflict or deleted - show modal instead of saving directly
    if (conflictedTabs[activeTabId] || deletedTabs.has(activeTabId)) {
      setPendingSaveTabId(activeTabId);
      setShowConflictModal(true);
      return;
    }

    await doSaveRequest(requestData, activeTabId);
  }, [activeTabId, conflictedTabs, deletedTabs]);

  const handleSaveExample = useCallback(async (exampleData) => {
    if (!activeTabId) return;

    // Check if there's a conflict or deleted - show modal instead of saving directly
    if (conflictedTabs[activeTabId] || deletedTabs.has(activeTabId)) {
      setPendingSaveTabId(activeTabId);
      setShowConflictModal(true);
      return;
    }

    await doSaveExample(exampleData, activeTabId);
  }, [activeTabId, conflictedTabs, deletedTabs]);

  // Update ref for keyboard handler
  useEffect(() => {
    saveFunctionsRef.current = { handleSaveRequest, handleSaveExample };
  }, [handleSaveRequest, handleSaveExample]);

  const handleOpenExample = (example, parentRequest) => {
    openExampleInTab(example, parentRequest);
  };

  const handleSidebarDeleteExample = async (id) => {
    await data.deleteExample(id);
  };

  const handleImport = async (importData) => {
    const loadingToast = toast.loading('Importing collection...');
    try {
      await data.importCollection(importData, activeWorkspace?.id);
      await loadCollections();
      toast.dismiss(loadingToast);
      toast.success('Collection imported successfully');
    } catch (err) {
      toast.dismiss(loadingToast);
      toast.error(err.message || 'Failed to import collection');
    }
  };

  const handleExportCollection = async (collection) => {
    try {
      const exportData = await data.exportCollection(collection.id);
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collection.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported "${collection.name}" successfully`);
    } catch (err) {
      toast.error(err.message || 'Failed to export collection');
    }
  };

  // Import cURL as temporary request
  const handleImportCurl = (parsed) => {
    const tempId = `temp-${Date.now()}`;
    const tempRequest = {
      id: tempId,
      name: 'Imported cURL',
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers,
      body: parsed.body,
      body_type: parsed.bodyType,
      isTemporary: true,
    };

    setOpenTabs(prev => [...prev, {
      id: tempId,
      type: 'request',
      request: tempRequest,
      dirty: false,
      response: null,
      isTemporary: true,
    }]);
    setActiveTabId(tempId);
  };

  // Try example - creates a temporary tab with empty body
  const handleTryExample = ({ method, url, headers, authType, authToken, exampleName }) => {
    const tempId = `temp-${Date.now()}`;
    const tempRequest = {
      id: tempId,
      name: `Try: ${exampleName || 'Example'}`,
      method,
      url,
      headers,
      body: '',
      body_type: 'none',
      auth_type: authType,
      auth_token: authToken,
      isTemporary: true,
    };

    setOpenTabs(prev => [...prev, {
      id: tempId,
      type: 'request',
      request: tempRequest,
      dirty: false,
      response: null,
      isTemporary: true,
    }]);
    setActiveTabId(tempId);
  };

  // Hide the initial HTML loader once auth is checked
  useEffect(() => {
    if (authChecked) {
      const initialLoader = document.getElementById('initial-loader');
      if (initialLoader) {
        // Fade out smoothly
        initialLoader.style.transition = 'opacity 0.2s ease-out';
        initialLoader.style.opacity = '0';
        setTimeout(() => {
          initialLoader.style.display = 'none';
        }, 200);
      }
    }
  }, [authChecked]);

  // Keep showing initial HTML loader while checking auth (render nothing)
  if (!authChecked) {
    return null;
  }

  // Show login if not authenticated
  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <img src="/umbrella.svg" alt="" className="app-logo" />
          <h1>Post Umbrella</h1>
        </div>
        <div className="header-right">
          <ThemeToggle theme={theme} onToggle={handleThemeChange} />
          {userProfile?.role === 'admin' && (
            <button
              className="btn-admin"
              onClick={() => setShowUserManagement(true)}
              title="User Management"
            >
              <Shield size={16} />
            </button>
          )}
          <WorkspaceSelector
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            onWorkspaceChange={handleWorkspaceChange}
            onCreateWorkspace={handleCreateWorkspace}
            onOpenSettings={handleOpenWorkspaceSettings}
            isAdmin={userProfile?.role === 'admin'}
          />
          <EnvironmentSelector
            environments={environments}
            activeEnvironment={activeEnvironment}
            onEnvironmentChange={() => currentRootCollectionId && loadEnvironments(currentRootCollectionId)}
            onOpenEditor={() => setShowEnvEditor(true)}
            collectionId={currentRootCollectionId}
          />
          <div className="header-actions">
            <button
              className="btn-import-curl"
              onClick={() => setShowImportCurl(true)}
              title="Import cURL"
            >
              <Terminal size={16} />
              Import cURL
            </button>
            <ImportExport onImport={handleImport} disabled={!activeWorkspace} />
          </div>
          <div className="user-menu">
            <span className="user-email">{user.email}</span>
            <button className="btn-logout" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          collections={collections}
          selectedRequest={selectedRequest}
          onSelectRequest={handleSelectRequest}
          onCreateCollection={handleCreateCollection}
          onCreateSubCollection={handleCreateSubCollection}
          onCreateRequest={handleCreateRequest}
          onDeleteCollection={handleDeleteCollection}
          onDeleteRequest={handleDeleteRequest}
          onDuplicateRequest={handleDuplicateRequest}
          onMoveRequest={handleMoveRequest}
          onExportCollection={handleExportCollection}
          onRenameCollection={handleRenameCollection}
          onRenameRequest={handleRenameRequest}
          width={sidebarWidth}
          onOpenExample={handleOpenExample}
          onCreateExample={handleCreateExample}
          onDeleteExample={handleSidebarDeleteExample}
          onDuplicateExample={handleDuplicateExample}
          onRenameExample={handleRenameExample}
          canAddCollection={!!activeWorkspace}
        />
        <div
          className="sidebar-resize-handle"
          onMouseDown={startResizing}
        />
        <main className="main-content" ref={mainContentRef}>
          <div className="open-tabs-bar">
            {openTabs.length === 0 ? (
              <div className="open-tabs-empty">No open requests</div>
            ) : (
              openTabs.map(tab => {
                const isExample = tab.type === 'example';
                const name = isExample ? tab.example?.name : tab.request?.name;
                const method = isExample ? tab.example?.request_data?.method : tab.request?.method;
                const isConflicted = !!conflictedTabs[tab.id];
                const isDeleted = deletedTabs.has(tab.id);

                // Build tooltip showing name with status
                let tooltip = `${isExample ? '[Example] ' : ''}${name || 'Untitled'}`;
                if (isDeleted) tooltip += ' [deleted]';
                else if (isConflicted) tooltip += ' [conflicted]';

                return (
                <div
                  key={tab.id}
                  className={`open-tab ${tab.id === activeTabId ? 'active' : ''} ${tab.isTemporary ? 'temporary' : ''} ${isExample ? 'example-tab' : ''} ${isConflicted ? 'conflicted' : ''} ${isDeleted ? 'deleted' : ''} ${draggingTabId === tab.id ? 'dragging' : ''} ${dragOverTabId === tab.id ? 'drag-over' : ''} ${previewTabId === tab.id ? 'preview' : ''}`}
                  onClick={() => setActiveTabId(tab.id)}
                  draggable
                  onDragStart={(e) => handleTabDragStart(e, tab.id)}
                  onDragEnd={handleTabDragEnd}
                  onDragOver={(e) => handleTabDragOver(e, tab.id)}
                  onDrop={(e) => handleTabDrop(e, tab.id)}
                  title={tooltip}
                >
                  {isExample ? (
                    <span className="tab-example-badge">EX</span>
                  ) : (
                    <span
                      className="tab-method"
                      style={{ color: METHOD_COLORS[method] || '#888' }}
                    >
                      {method}
                    </span>
                  )}
                  <span className="tab-name">
                    {tab.isTemporary && <Terminal size={12} />}
                    {name}
                  </span>
                  {isDeleted && <span className="tab-status deleted">[deleted]</span>}
                  {isConflicted && !isDeleted && <span className="tab-status conflicted">[conflicted]</span>}
                  {tab.dirty && <span className="tab-dirty" title="Unsaved changes (Ctrl+S to save)" />}
                  <span
                    className="tab-close"
                    onClick={(e) => closeTab(tab.id, e)}
                    title="Close"
                  >
                    ×
                  </span>
                </div>
              );})
            )}
          </div>

          <RequestEditor
            request={selectedRequest}
            example={selectedExample}
            isExample={activeTab?.type === 'example'}
            onSend={handleSendRequest}
            onSave={activeTab?.type === 'example' ? handleSaveExample : handleSaveRequest}
            onSaveAsExample={handleSaveAsExample}
            onTry={handleTryExample}
            onRequestChange={activeTab?.type === 'example' ? updateTabExample : updateTabRequest}
            loading={loading}
            response={response}
            dirty={activeTab?.dirty}
            isTemporary={activeTab?.isTemporary}
            activeEnvironment={activeEnvironment}
            onEnvironmentUpdate={loadEnvironments}
            height={requestEditorHeight}
            activeDetailTab={activeTab?.activeDetailTab || 'params'}
            onActiveDetailTabChange={updateActiveDetailTab}
          />
          <div
            className="vertical-resize-handle"
            onMouseDown={startResizingVertical}
          />
          <ResponseViewer
            response={response}
            loading={loading}
            isExample={activeTab?.type === 'example'}
            example={selectedExample}
            onExampleChange={activeTab?.type === 'example' ? updateTabExample : undefined}
          />
        </main>

      </div>

      {showEnvEditor && (
        <EnvironmentEditor
          onClose={() => {
            setShowEnvEditor(false);
            if (currentRootCollectionId) {
              loadEnvironments(currentRootCollectionId);
            }
          }}
          collectionId={currentRootCollectionId}
          collectionName={collections.find(c => c.id === currentRootCollectionId)?.name}
        />
      )}

      {showWorkspaceSettings && activeWorkspace && (
        <WorkspaceSettings
          workspace={activeWorkspace}
          members={workspaceMembers}
          onClose={() => setShowWorkspaceSettings(false)}
          onUpdateWorkspace={handleUpdateWorkspace}
          onAddMember={handleAddWorkspaceMember}
          onRemoveMember={handleRemoveWorkspaceMember}
          onDeleteWorkspace={handleDeleteWorkspace}
          currentUserId={user?.id}
          isAdmin={userProfile?.role === 'admin'}
        />
      )}

      {showUserManagement && (
        <UserManagement
          users={allUsers}
          allWorkspaces={allWorkspaces}
          onClose={() => setShowUserManagement(false)}
          onInviteUser={handleInviteUser}
          onUpdateUser={handleUpdateUser}
          onUpdateUserWorkspaces={handleUpdateUserWorkspaces}
        />
      )}

      {showImportCurl && (
        <ImportCurlModal
          onImport={handleImportCurl}
          onClose={() => setShowImportCurl(false)}
        />
      )}

      {showConflictModal && (() => {
        const isDeletedModal = deletedTabs.has(pendingSaveTabId);
        return (
          <div className="modal-overlay" onClick={() => setShowConflictModal(false)}>
            <div className="modal conflict-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2><AlertTriangle size={18} /> {isDeletedModal ? 'Item Deleted' : 'Conflict Detected'}</h2>
                <button className="modal-close" onClick={() => setShowConflictModal(false)}>
                  <X size={18} />
                </button>
              </div>
              <div className="modal-body">
                <p className="modal-hint">
                  {isDeletedModal
                    ? 'This item has been deleted by someone else while you were editing it. You can create a new item with your changes or close this tab.'
                    : 'Someone else has modified this request while you were editing it. Choose how you want to resolve this conflict.'
                  }
                </p>
              </div>
              <div className="modal-footer conflict-footer">
                <button className="btn-secondary" onClick={() => setShowConflictModal(false)}>
                  Cancel
                </button>
                <button className="btn-secondary" onClick={handleDiscardChanges}>
                  {isDeletedModal ? 'Close Tab' : 'Discard'}
                </button>
                <button className={isDeletedModal ? 'btn-primary' : 'btn-danger'} onClick={handleOverwriteConflict}>
                  {isDeletedModal ? 'Create New' : 'Overwrite'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default App;
