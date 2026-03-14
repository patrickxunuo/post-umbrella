import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';
import { useCollectionData } from '../hooks/useCollectionData';
import { useConflictResolution } from '../hooks/useConflictResolution';
import { useRequestActions } from '../hooks/useRequestActions';
import { useResponseExecution } from '../hooks/useResponseExecution';
import * as data from '../data/index.js';

const WorkbenchContext = createContext(null);

function patchRequestInCollections(collections, requestId, updater) {
  return collections.map((collection) => ({
    ...collection,
    requests: (collection.requests || []).map((request) => (
      request.id === requestId ? updater(request) : request
    )),
  }));
}

function removeRequestFromCollections(collections, requestId) {
  return collections.map((collection) => ({
    ...collection,
    requests: (collection.requests || []).filter((request) => request.id !== requestId),
  }));
}

function insertRequestIntoCollection(collections, collectionId, request) {
  return collections.map((collection) => (
    collection.id === collectionId
      ? {
          ...collection,
          requests: [...(collection.requests || []), request].sort((a, b) => {
            const sortA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
            const sortB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
            if (sortA !== sortB) return sortA - sortB;
            return (a.created_at || 0) - (b.created_at || 0);
          }),
        }
      : collection
  ));
}

function moveRequestInCollections(collections, updatedRequest) {
  return insertRequestIntoCollection(
    removeRequestFromCollections(collections, updatedRequest.id),
    updatedRequest.collection_id,
    updatedRequest
  );
}

export function WorkbenchProvider({ children, prompt, confirm, toast }) {
  const { user, authChecked } = useAuth();
  const {
    activeWorkspace,
    setActiveWorkspace,
    pendingSharedLink,
    consumePendingSharedLink,
    workspaceBootstrapComplete,
    userProfile,
  } = useWorkspace();
  const [openTabs, setOpenTabs] = useState(() => {
    const saved = localStorage.getItem('openTabs');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeTabId, setActiveTabId] = useState(() => localStorage.getItem('activeTabId') || null);
  const [conflictedTabs, setConflictedTabs] = useState({});
  const [deletedTabs, setDeletedTabs] = useState(new Set());
  const [previewTabId, setPreviewTabId] = useState(null);
  const [pendingRequestIds, setPendingRequestIds] = useState(new Set());
  const [pendingExampleIds, setPendingExampleIds] = useState(new Set());
  const [pendingExampleListRequestIds, setPendingExampleListRequestIds] = useState(new Set());
  const [pendingCollectionIds, setPendingCollectionIds] = useState(new Set());
  const [revealRequestId, setRevealRequestId] = useState(null);
  const recentlyModifiedRef = useRef(new Map());
  const previousWorkspaceIdRef = useRef(null);
  const originalRequestsRef = useRef({});
  const handleCollectionsLoadedRef = useRef(null);
  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  const selectedRequest = activeTab?.type === 'request' ? activeTab.request : null;
  const selectedExample = activeTab?.type === 'example' ? activeTab.example : null;
  const response = activeTab?.response || null;

  const markAsRecentlyModified = useCallback((tabId) => {
    recentlyModifiedRef.current.set(tabId, Date.now());
    setTimeout(() => {
      recentlyModifiedRef.current.delete(tabId);
    }, 5000);
  }, []);

  const wasRecentlyModified = useCallback((tabId) => {
    const timestamp = recentlyModifiedRef.current.get(tabId);
    if (!timestamp) return false;
    return Date.now() - timestamp < 5000;
  }, []);

  const {
    collections,
    setCollections,
    collectionsLoading,
    examples,
    setExamples,
    environments,
    setEnvironments,
    activeEnvironment,
    setActiveEnvironment,
    currentRootCollectionId,
    setCurrentRootCollectionId,
    loadCollections,
    loadEnvironments,
  } = useCollectionData({
    user,
    activeWorkspace,
    activeTab,
    selectedRequest,
    selectedExample,
    onCollectionsLoaded: useCallback((nextCollections, workspaceId) => {
      handleCollectionsLoadedRef.current?.(nextCollections, workspaceId);
    }, []),
  });

  useEffect(() => {
    const workspaceId = activeWorkspace?.id || null;

    if (previousWorkspaceIdRef.current === null) {
      previousWorkspaceIdRef.current = workspaceId;
      return;
    }

    if (previousWorkspaceIdRef.current !== workspaceId) {
      setOpenTabs([]);
      setActiveTabId(null);
      setExamples([]);
      setEnvironments([]);
      setActiveEnvironment(null);
      setCurrentRootCollectionId(null);
      previousWorkspaceIdRef.current = workspaceId;
    }
  }, [activeWorkspace?.id, setActiveEnvironment, setCurrentRootCollectionId, setEnvironments, setExamples]);

  useEffect(() => {
    if (authChecked && !user) {
      setCollections([]);
      setOpenTabs([]);
      setActiveTabId(null);
      setExamples([]);
      setEnvironments([]);
      setActiveEnvironment(null);
      setCurrentRootCollectionId(null);
      setActiveWorkspace(null);
    }
  }, [authChecked, setActiveWorkspace, setActiveEnvironment, setCollections, setCurrentRootCollectionId, setEnvironments, setExamples, user]);

  useEffect(() => {
    const persistentTabs = openTabs.filter((tab) => !tab.isTemporary);
    localStorage.setItem('openTabs', JSON.stringify(persistentTabs));
  }, [openTabs]);

  useEffect(() => {
    if (!activeTabId) return;
    const currentTab = openTabs.find((tab) => tab.id === activeTabId);
    if (!currentTab?.isTemporary) {
      localStorage.setItem('activeTabId', activeTabId);
    }
  }, [activeTabId, openTabs]);

  useEffect(() => {
    openTabs.forEach((tab) => {
      if (originalRequestsRef.current[tab.id]) return;
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
    });
  }, [openTabs]);

  // Apply UI state transferred from web via "Open in App" deep link
  const transferHandledRef = useRef(false);
  useEffect(() => {
    if (transferHandledRef.current || collectionsLoading || !user) return;
    const transfer = window.__DESKTOP_TRANSFER__;
    if (!transfer) return;
    transferHandledRef.current = true;
    delete window.__DESKTOP_TRANSFER__;

    const hasTabs = transfer.tabIds.length > 0;
    const hasSidebar = transfer.expandedCollections.length > 0 || transfer.expandedRequests.length > 0;
    if (!hasTabs && !hasSidebar) return;

    (async () => {
      const accepted = await confirm({
        title: 'Restore browser session?',
        message: 'Apply your open tabs and sidebar state from the browser?',
        confirmText: 'Restore',
        cancelText: 'Skip',
      });
      if (!accepted) return;

      // Restore expanded state
      if (transfer.expandedCollections.length) {
        localStorage.setItem('expandedCollections', JSON.stringify(transfer.expandedCollections));
      }
      if (transfer.expandedRequests.length) {
        localStorage.setItem('expandedRequests', JSON.stringify(transfer.expandedRequests));
      }
      // Dispatch event so Sidebar picks up new expanded state without reload
      window.dispatchEvent(new CustomEvent('expanded-state-updated'));

      // Fetch and open transferred tabs
      if (transfer.tabIds.length === 0) return;
      const newTabs = (await Promise.all(
        transfer.tabIds.map(async (id) => {
          try {
            const fullRequest = await data.getRequest(id);
            const hasBody = fullRequest.body_type && fullRequest.body_type !== 'none';
            return {
              id: `request-${id}`,
              type: 'request',
              entityId: id,
              request: fullRequest,
              dirty: false,
              response: null,
              activeDetailTab: hasBody ? 'body' : 'params',
            };
          } catch {
            return null;
          }
        })
      )).filter(Boolean);

      if (newTabs.length > 0) {
        setOpenTabs(newTabs);
        setActiveTabId(transfer.activeTabId ? `request-${transfer.activeTabId}` : newTabs[0].id);
      }
    })();
  }, [collectionsLoading, confirm, setOpenTabs, setActiveTabId, user]);

  const {
    openRequestInTab,
    openExampleInTab,
    closeTab,
    handleCreateCollection,
    handleCreateSubCollection,
    handleCreateRequest,
    handleDeleteCollection,
    handleDeleteRequest,
    handleDuplicateRequest,
    handleMoveRequest,
    handleRenameCollection,
    handleRenameRequest,
    handleCreateExample,
    handleDuplicateExample,
    handleSaveAsExample,
    handleRenameExample,
    handleSelectRequest,
    handleOpenExample,
    handleSidebarDeleteExample,
    handleImport,
    handleExportCollection,
    handleImportCurl,
    handleTryExample,
  } = useRequestActions({
    prompt,
    confirm,
    toast,
    activeWorkspace,
    selectedRequest,
    openTabs,
    activeTabId,
    previewTabId,
    collections,
    setCollections,
    setPendingRequestIds,
    setPendingExampleIds,
    setPendingExampleListRequestIds,
    setPendingCollectionIds,
    setOpenTabs,
    setActiveTabId,
    setPreviewTabId,
    setConflictedTabs,
    setDeletedTabs,
    originalRequestsRef,
    markAsRecentlyModified,
  });

  handleCollectionsLoadedRef.current = async (nextCollections, workspaceId) => {
    if (!workspaceBootstrapComplete || !pendingSharedLink || !activeWorkspace?.id || workspaceId !== activeWorkspace.id) {
      return;
    }

    try {
      if (pendingSharedLink.type === 'request') {
        const request = await data.getRequest(pendingSharedLink.id);
        const inLoadedWorkspace = nextCollections.some((item) => item.id === request.collection_id);
        if (!inLoadedWorkspace) {
          toast.info('This shared request belongs to a different workspace.');
          consumePendingSharedLink();
          return;
        }

        await openRequestInTab(request, { replacePreview: false });
        setRevealRequestId(request.id);
        consumePendingSharedLink();
        return;
      }

      if (pendingSharedLink.type === 'example') {
        const example = await data.getExample(pendingSharedLink.id);
        const parentRequest = await data.getRequest(example.request_id);
        const inLoadedWorkspace = nextCollections.some((item) => item.id === parentRequest.collection_id);
        if (!inLoadedWorkspace) {
          toast.info('This shared example belongs to a different workspace.');
          consumePendingSharedLink();
          return;
        }

        await openExampleInTab(example, parentRequest, { replacePreview: false });
        setRevealRequestId(parentRequest.id);
        consumePendingSharedLink();
      }
    } catch (error) {
      console.error('Failed to open shared item:', error);
      toast.error('Unable to open the shared item.');
      consumePendingSharedLink();
    }
  };

  const {
    showConflictModal,
    setShowConflictModal,
    pendingSaveTabId,
    handleOverwriteConflict,
    handleDiscardChanges,
    handleSaveRequest,
    handleSaveExample,
  } = useConflictResolution({
    toast,
    openTabs,
    activeTabId,
    conflictedTabs,
    setConflictedTabs,
    deletedTabs,
    setDeletedTabs,
    setPendingRequestIds,
    setPendingExampleIds,
    setOpenTabs,
    setActiveTabId,
    originalRequestsRef,
    markAsRecentlyModified,
    openRequestInTab,
    openExampleInTab,
  });

  const {
    loading,
    handleSendRequest,
  } = useResponseExecution({
    toast,
    activeTabId,
    activeEnvironment,
    activeWorkspaceId: activeWorkspace?.id,
    loadEnvironments,
    setActiveEnvironment,
    setOpenTabs,
  });

  const updateTabRequest = useCallback((updates) => {
    if (!activeTabId) return;

    setOpenTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabId) return tab;

      const request = { ...tab.request, ...updates };
      const current = JSON.stringify({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
        body_type: request.body_type,
        form_data: request.form_data,
        auth_type: request.auth_type,
        auth_token: request.auth_token,
        pre_script: request.pre_script,
        post_script: request.post_script,
      });
      const dirty = current !== originalRequestsRef.current[tab.id];

      if (dirty && previewTabId === tab.id) {
        setPreviewTabId(null);
      }

      return { ...tab, request, dirty };
    }));
  }, [activeTabId, previewTabId]);

  const updateTabExample = useCallback((updates) => {
    if (!activeTabId) return;

    setOpenTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabId) return tab;

      const example = { ...tab.example, ...updates };
      const current = JSON.stringify({
        name: example.name,
        request_data: example.request_data,
        response_data: example.response_data,
      });
      const dirty = current !== originalRequestsRef.current[tab.id];

      if (dirty && previewTabId === tab.id) {
        setPreviewTabId(null);
      }

      return { ...tab, example, dirty };
    }));
  }, [activeTabId, previewTabId]);

  const updateActiveDetailTab = useCallback((tabName) => {
    if (!activeTabId) return;
    setOpenTabs((prev) => prev.map((tab) => (
      tab.id === activeTabId ? { ...tab, activeDetailTab: tabName } : tab
    )));
  }, [activeTabId]);

  const saveStateRef = useRef({ activeTab, selectedRequest, selectedExample });
  useEffect(() => {
    saveStateRef.current = { activeTab, selectedRequest, selectedExample };
  }, [activeTab, selectedExample, selectedRequest]);

  const saveFunctionsRef = useRef({ handleSaveRequest: null, handleSaveExample: null });
  useEffect(() => {
    saveFunctionsRef.current = { handleSaveRequest, handleSaveExample };
  }, [handleSaveExample, handleSaveRequest]);

  const canEditRef = useRef(false);
  useEffect(() => {
    canEditRef.current = ['system', 'admin', 'developer'].includes(userProfile?.role);
  }, [userProfile?.role]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
      event.preventDefault();

      // Readers cannot save
      if (!canEditRef.current) return;

      const currentSaveState = saveStateRef.current;
      const currentSaveFunctions = saveFunctionsRef.current;

      if (!currentSaveState.activeTab?.dirty) return;

      if (currentSaveState.activeTab.type === 'example' && currentSaveState.selectedExample && currentSaveFunctions.handleSaveExample) {
        currentSaveFunctions.handleSaveExample({
          name: currentSaveState.selectedExample.name,
          request_data: currentSaveState.selectedExample.request_data,
          response_data: currentSaveState.selectedExample.response_data,
        });
        return;
      }

      if (currentSaveState.selectedRequest && !currentSaveState.activeTab?.isTemporary && currentSaveFunctions.handleSaveRequest) {
        currentSaveFunctions.handleSaveRequest({
          method: currentSaveState.selectedRequest.method,
          url: currentSaveState.selectedRequest.url,
          headers: currentSaveState.selectedRequest.headers,
          body: currentSaveState.selectedRequest.body,
          body_type: currentSaveState.selectedRequest.body_type,
          auth_type: currentSaveState.selectedRequest.auth_type,
          auth_token: currentSaveState.selectedRequest.auth_token,
          params: currentSaveState.selectedRequest.params,
          pre_script: currentSaveState.selectedRequest.pre_script,
          post_script: currentSaveState.selectedRequest.post_script,
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const value = {
    openTabs,
    setOpenTabs,
    activeTabId,
    setActiveTabId,
    conflictedTabs,
    setConflictedTabs,
    deletedTabs,
    setDeletedTabs,
    previewTabId,
    setPreviewTabId,
    pendingRequestIds,
    pendingExampleIds,
    pendingExampleListRequestIds,
    pendingCollectionIds,
    revealRequestId,
    setRevealRequestId,
    activeTab,
    selectedRequest,
    selectedExample,
    response,
    collections,
    setCollections,
    collectionsLoading,
    examples,
    setExamples,
    environments,
    setEnvironments,
    activeEnvironment,
    setActiveEnvironment,
    currentRootCollectionId,
    setCurrentRootCollectionId,
    loadCollections,
    loadEnvironments,
    loading,
    openRequestInTab,
    openExampleInTab,
    closeTab,
    handleCreateCollection,
    handleCreateSubCollection,
    handleCreateRequest,
    handleDeleteCollection,
    handleDeleteRequest,
    handleDuplicateRequest,
    handleMoveRequest,
    handleRenameCollection,
    handleRenameRequest,
    handleCreateExample,
    handleDuplicateExample,
    handleSaveAsExample,
    handleRenameExample,
    handleSelectRequest,
    handleOpenExample,
    handleSidebarDeleteExample,
    handleImport,
    handleExportCollection,
    handleImportCurl,
    handleTryExample,
    showConflictModal,
    setShowConflictModal,
    pendingSaveTabId,
    handleOverwriteConflict,
    handleDiscardChanges,
    handleSaveRequest,
    handleSaveExample,
    handleSendRequest,
    updateTabRequest,
    updateTabExample,
    updateActiveDetailTab,
    wasRecentlyModified,
  };

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error('useWorkbench must be used within a WorkbenchProvider');
  }
  return context;
}
