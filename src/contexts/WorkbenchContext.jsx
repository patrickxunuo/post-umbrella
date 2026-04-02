import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';
import { useConflictResolution } from '../hooks/useConflictResolution';
import { useRequestActions } from '../hooks/useRequestActions';
import { useResponseExecution } from '../hooks/useResponseExecution';
import useWorkbenchStore from '../stores/workbenchStore';
import useCollectionStore from '../stores/collectionStore';
import * as data from '../data/index.js';

const WorkbenchContext = createContext(null);

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

  // Read tab state from workbench store
  const openTabs = useWorkbenchStore((s) => s.openTabs);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  const previewTabId = useWorkbenchStore((s) => s.previewTabId);
  const conflictedTabs = useWorkbenchStore((s) => s.conflictedTabs);
  const deletedTabs = useWorkbenchStore((s) => s.deletedTabs);
  const pendingRequestIds = useWorkbenchStore((s) => s.pendingRequestIds);
  const pendingExampleIds = useWorkbenchStore((s) => s.pendingExampleIds);
  const pendingExampleListRequestIds = useWorkbenchStore((s) => s.pendingExampleListRequestIds);
  const pendingCollectionIds = useWorkbenchStore((s) => s.pendingCollectionIds);
  const workflows = useWorkbenchStore((s) => s.workflows);
  const setOpenTabs = useWorkbenchStore((s) => s.setOpenTabs);
  const setActiveTabId = useWorkbenchStore((s) => s.setActiveTabId);
  const setPreviewTabId = useWorkbenchStore((s) => s.setPreviewTabId);
  const setConflictedTabs = useWorkbenchStore((s) => s.setConflictedTabs);
  const setDeletedTabs = useWorkbenchStore((s) => s.setDeletedTabs);
  const setPendingRequestIds = useWorkbenchStore((s) => s.setPendingRequestIds);
  const setPendingExampleIds = useWorkbenchStore((s) => s.setPendingExampleIds);
  const setPendingExampleListRequestIds = useWorkbenchStore((s) => s.setPendingExampleListRequestIds);
  const setPendingCollectionIds = useWorkbenchStore((s) => s.setPendingCollectionIds);
  const setRevealRequestId = useWorkbenchStore((s) => s.setRevealRequestId);
  const setRevealCollectionId = useWorkbenchStore((s) => s.setRevealCollectionId);
  const setWorkflows = useWorkbenchStore((s) => s.setWorkflows);
  const markAsRecentlyModified = useWorkbenchStore((s) => s.markAsRecentlyModified);
  const loadWorkflows = useWorkbenchStore((s) => s.loadWorkflows);
  const resetTabs = useWorkbenchStore((s) => s.resetTabs);

  // Read collection state from collection store
  const collections = useCollectionStore((s) => s.collections);
  const collectionsLoading = useCollectionStore((s) => s.collectionsLoading);
  const examples = useCollectionStore((s) => s.examples);
  const environments = useCollectionStore((s) => s.environments);
  const activeEnvironment = useCollectionStore((s) => s.activeEnvironment);
  const currentRootCollectionId = useCollectionStore((s) => s.currentRootCollectionId);
  const setCollections = useCollectionStore((s) => s.setCollections);
  const setExamples = useCollectionStore((s) => s.setExamples);
  const setEnvironments = useCollectionStore((s) => s.setEnvironments);
  const setActiveEnvironment = useCollectionStore((s) => s.setActiveEnvironment);
  const setCurrentRootCollectionId = useCollectionStore((s) => s.setCurrentRootCollectionId);
  const getRootCollectionId = useCollectionStore((s) => s.getRootCollectionId);
  const resetCollections = useCollectionStore((s) => s.reset);

  // Derived tab state
  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  const selectedRequest = activeTab?.type === 'request' ? activeTab.request : null;
  const selectedExample = activeTab?.type === 'example' ? activeTab.example : null;
  const response = activeTab?.response || null;

  // Ref for original requests — proxy to store's mutable data
  const originalRequestsRef = useRef(useWorkbenchStore.getState()._originalRequests);

  const previousWorkspaceIdRef = useRef(null);
  const handleCollectionsLoadedRef = useRef(null);

  // Wrapper callbacks that close over user/workspace for hooks
  const onCollectionsLoaded = useCallback((nextCollections, workspaceId) => {
    handleCollectionsLoadedRef.current?.(nextCollections, workspaceId);
  }, []);

  const loadCollections = useCallback(() => {
    return useCollectionStore.getState().loadCollections(user, activeWorkspace, onCollectionsLoaded);
  }, [user, activeWorkspace, onCollectionsLoaded]);

  const loadEnvironments = useCallback((workspaceId) => {
    return useCollectionStore.getState().loadEnvironments(user, workspaceId);
  }, [user]);

  const loadExamples = useCallback((requestId) => {
    return useCollectionStore.getState().loadExamples(user, requestId);
  }, [user]);

  // --- Effects (formerly in useCollectionData) ---

  // Load collections + environments when user/workspace changes
  useEffect(() => {
    if (!user) {
      resetCollections();
      return;
    }
    if (activeWorkspace) {
      loadCollections();
      loadEnvironments(activeWorkspace.id);
    }
  }, [user, activeWorkspace, loadCollections, loadEnvironments, resetCollections]);

  // Load examples when selected request changes
  useEffect(() => {
    loadExamples(selectedRequest?.id);
  }, [selectedRequest?.id, loadExamples]);

  // Track current root collection for realtime updates
  useEffect(() => {
    let collectionId = null;
    if (selectedRequest?.collection_id) {
      collectionId = selectedRequest.collection_id;
    } else if (selectedExample) {
      const parentRequestId = activeTab?.parentRequestId || selectedExample.request_id;
      if (parentRequestId && collections.length > 0) {
        for (const collection of collections) {
          const foundRequest = collection.requests?.find((r) => r.id === parentRequestId);
          if (foundRequest) {
            collectionId = foundRequest.collection_id;
            break;
          }
        }
      }
    }

    if (collectionId && collections.length > 0) {
      const rootId = getRootCollectionId(collectionId);
      if (rootId !== currentRootCollectionId) {
        setCurrentRootCollectionId(rootId);
      }
    } else if (!selectedRequest && !selectedExample) {
      setCurrentRootCollectionId(null);
    }
  }, [
    selectedRequest?.collection_id, selectedExample, activeTab?.parentRequestId,
    collections, getRootCollectionId, currentRootCollectionId, setCurrentRootCollectionId,
  ]);

  // --- Tab effects ---

  // Workspace switch — clear tabs + collection data
  useEffect(() => {
    const workspaceId = activeWorkspace?.id || null;
    if (previousWorkspaceIdRef.current === null) {
      previousWorkspaceIdRef.current = workspaceId;
      return;
    }
    if (previousWorkspaceIdRef.current !== workspaceId) {
      resetTabs();
      setExamples([]);
      setEnvironments([]);
      setActiveEnvironment(null);
      setCurrentRootCollectionId(null);
      previousWorkspaceIdRef.current = workspaceId;
    }
  }, [activeWorkspace?.id, resetTabs, setActiveEnvironment, setCurrentRootCollectionId, setEnvironments, setExamples]);

  // Logout — clear everything
  useEffect(() => {
    if (authChecked && !user) {
      resetCollections();
      resetTabs();
      setActiveWorkspace(null);
    }
  }, [authChecked, resetCollections, resetTabs, setActiveWorkspace, user]);

  // Persist tabs to localStorage
  useEffect(() => {
    const persistentTabs = openTabs.filter((tab) => !tab.isTemporary).map(tab => {
      const { runState, docsCache, ...rest } = tab;
      return rest;
    });
    localStorage.setItem('openTabs', JSON.stringify(persistentTabs));
  }, [openTabs]);

  useEffect(() => {
    if (!activeTabId) return;
    const currentTab = openTabs.find((tab) => tab.id === activeTabId);
    if (!currentTab?.isTemporary) {
      localStorage.setItem('activeTabId', activeTabId);
    }
  }, [activeTabId, openTabs]);

  // Load workflows
  useEffect(() => {
    if (activeWorkspace?.id) loadWorkflows();
  }, [activeWorkspace?.id, loadWorkflows]);

  // Track original request state for dirty detection
  useEffect(() => {
    const originals = originalRequestsRef.current;
    openTabs.forEach((tab) => {
      if (originals[tab.id]) return;
      if (tab.type === 'request' && tab.request) {
        originals[tab.id] = JSON.stringify({
          method: tab.request.method, url: tab.request.url, headers: tab.request.headers,
          body: tab.request.body, body_type: tab.request.body_type, form_data: tab.request.form_data,
          auth_type: tab.request.auth_type, auth_token: tab.request.auth_token,
          pre_script: tab.request.pre_script, post_script: tab.request.post_script,
        });
      } else if (tab.type === 'example' && tab.example) {
        originals[tab.id] = JSON.stringify({
          name: tab.example.name, request_data: tab.example.request_data, response_data: tab.example.response_data,
        });
      } else if (tab.type === 'workflow' && tab.workflow) {
        originals[tab.id] = JSON.stringify({
          name: tab.workflow.name, steps: tab.workflow.steps,
        });
      }
    });
  }, [openTabs]);

  // Desktop transfer handler
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

    toast.action('Restore browser session?', {
      label: 'Restore',
      onClick: async () => {
        if (transfer.expandedCollections.length) {
          localStorage.setItem('expandedCollections', JSON.stringify(transfer.expandedCollections));
        }
        if (transfer.expandedRequests.length) {
          localStorage.setItem('expandedRequests', JSON.stringify(transfer.expandedRequests));
        }
        window.dispatchEvent(new CustomEvent('expanded-state-updated'));

        if (transfer.tabIds.length === 0) return;
        const newTabs = (await Promise.all(
          transfer.tabIds.map(async (id) => {
            try {
              const fullRequest = await data.getRequest(id);
              const hasBody = fullRequest.body_type && fullRequest.body_type !== 'none';
              return {
                id: `request-${id}`, type: 'request', entityId: id,
                request: fullRequest, dirty: false, response: null,
                activeDetailTab: hasBody ? 'body' : 'params',
              };
            } catch { return null; }
          })
        )).filter(Boolean);

        if (newTabs.length > 0) {
          setOpenTabs(newTabs);
          setActiveTabId(transfer.activeTabId ? `request-${transfer.activeTabId}` : newTabs[0].id);
        }
      },
      duration: 15000,
    });
  }, [collectionsLoading, toast, setOpenTabs, setActiveTabId, user]);

  // --- Hook composition ---

  const {
    openCollectionInTab, openRequestInTab, openExampleInTab, closeTab,
    handleCreateCollection, handleCreateSubCollection, handleCreateRequest,
    handleDeleteCollection, handleDeleteRequest, handleDuplicateRequest,
    handleRenameCollection, handleRenameRequest,
    handleCreateExample, handleDuplicateExample, handleSaveAsExample,
    handleRenameExample, handleSelectRequest, handleOpenExample,
    handleSidebarDeleteExample, handleImport, handleExportCollection,
    handleImportCurl, handleTryExample, openWorkflowInTab, openDocsInTab,
  } = useRequestActions({
    prompt, confirm, toast, activeWorkspace, selectedRequest,
    openTabs, activeTabId, previewTabId, collections, setCollections,
    setPendingRequestIds, setPendingExampleIds, setPendingExampleListRequestIds,
    setPendingCollectionIds, setOpenTabs, setActiveTabId, setPreviewTabId,
    setConflictedTabs, setDeletedTabs, originalRequestsRef, markAsRecentlyModified,
  });

  // Shared link handler
  handleCollectionsLoadedRef.current = async (nextCollections, workspaceId) => {
    if (!workspaceBootstrapComplete || !pendingSharedLink || !activeWorkspace?.id || workspaceId !== activeWorkspace.id) {
      return;
    }

    try {
      if (pendingSharedLink.type === 'collection' || pendingSharedLink.type === 'folder') {
        const found = nextCollections.find((c) => c.id === pendingSharedLink.id);
        if (!found) {
          toast.info('This shared item belongs to a different workspace.');
          consumePendingSharedLink();
          return;
        }
        await openCollectionInTab(found, { replacePreview: false });
        setRevealCollectionId(pendingSharedLink.id);
        consumePendingSharedLink();
        return;
      }

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
    showConflictModal, setShowConflictModal, pendingSaveTabId,
    handleOverwriteConflict, handleDiscardChanges, handleSaveRequest, handleSaveExample,
  } = useConflictResolution({
    toast, openTabs, activeTabId, conflictedTabs,
    setConflictedTabs, deletedTabs, setDeletedTabs,
    setPendingRequestIds, setPendingExampleIds,
    setOpenTabs, setActiveTabId, originalRequestsRef,
    markAsRecentlyModified, openRequestInTab, openExampleInTab,
  });

  const {
    loading, handleSendRequest, cancelRequest,
  } = useResponseExecution({
    toast, activeTabId, activeEnvironment,
    activeWorkspaceId: activeWorkspace?.id,
    collections, loadEnvironments, setActiveEnvironment, setOpenTabs,
  });

  // Read store operations
  const updateTabRequest = useWorkbenchStore((s) => s.updateTabRequest);
  const updateTabExample = useWorkbenchStore((s) => s.updateTabExample);
  const initCollectionTab = useWorkbenchStore((s) => s.initCollectionTab);
  const updateTabCollection = useWorkbenchStore((s) => s.updateTabCollection);
  const updateTabWorkflow = useWorkbenchStore((s) => s.updateTabWorkflow);
  const updateActiveDetailTab = useWorkbenchStore((s) => s.updateActiveDetailTab);
  const handleSaveCollection = useWorkbenchStore((s) => s.handleSaveCollection);
  const handleSaveWorkflow = useWorkbenchStore((s) => s.handleSaveWorkflow);
  const wasRecentlyModified = useWorkbenchStore((s) => s.wasRecentlyModified);
  const revealRequestId = useWorkbenchStore((s) => s.revealRequestId);
  const revealCollectionId = useWorkbenchStore((s) => s.revealCollectionId);

  // --- Ctrl+S handler ---
  const saveStateRef = useRef({ activeTab, selectedRequest, selectedExample });
  useEffect(() => {
    saveStateRef.current = { activeTab, selectedRequest, selectedExample };
  }, [activeTab, selectedExample, selectedRequest]);

  const saveFunctionsRef = useRef({ handleSaveRequest: null, handleSaveExample: null, handleSaveTempRequest: null, handleSaveCollection: null });
  useEffect(() => {
    saveFunctionsRef.current = { handleSaveRequest, handleSaveExample, handleSaveCollection, handleSaveWorkflow, handleSaveTempRequest: saveFunctionsRef.current.handleSaveTempRequest };
  }, [handleSaveExample, handleSaveRequest, handleSaveCollection, handleSaveWorkflow]);

  const canEditRef = useRef(false);
  useEffect(() => {
    canEditRef.current = ['system', 'admin', 'developer'].includes(userProfile?.role);
  }, [userProfile?.role]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
      event.preventDefault();
      if (!canEditRef.current) return;

      const currentSaveState = saveStateRef.current;
      const currentSaveFunctions = saveFunctionsRef.current;

      if (currentSaveState.activeTab?.isTemporary && currentSaveFunctions.handleSaveTempRequest) {
        currentSaveFunctions.handleSaveTempRequest(currentSaveState.activeTab);
        return;
      }
      if (!currentSaveState.activeTab?.dirty) return;
      if (currentSaveState.activeTab.type === 'collection' && currentSaveFunctions.handleSaveCollection) {
        currentSaveFunctions.handleSaveCollection();
        return;
      }
      if (currentSaveState.activeTab.type === 'workflow' && currentSaveFunctions.handleSaveWorkflow) {
        currentSaveFunctions.handleSaveWorkflow();
        return;
      }
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
          method: currentSaveState.selectedRequest.method, url: currentSaveState.selectedRequest.url,
          headers: currentSaveState.selectedRequest.headers, body: currentSaveState.selectedRequest.body,
          body_type: currentSaveState.selectedRequest.body_type, auth_type: currentSaveState.selectedRequest.auth_type,
          auth_token: currentSaveState.selectedRequest.auth_token, params: currentSaveState.selectedRequest.params,
          pre_script: currentSaveState.selectedRequest.pre_script, post_script: currentSaveState.selectedRequest.post_script,
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const value = {
    openTabs, setOpenTabs, activeTabId, setActiveTabId,
    conflictedTabs, setConflictedTabs, deletedTabs, setDeletedTabs,
    previewTabId, pendingRequestIds, pendingExampleIds,
    pendingExampleListRequestIds, pendingCollectionIds,
    revealRequestId, setRevealRequestId, revealCollectionId, setRevealCollectionId,
    activeTab, selectedRequest, selectedExample, response,
    collections, setCollections, collectionsLoading,
    examples, setExamples, environments, activeEnvironment, setActiveEnvironment,
    loadCollections, loadEnvironments, loading,
    openCollectionInTab, openRequestInTab, openExampleInTab, saveFunctionsRef, closeTab,
    handleCreateCollection, handleCreateSubCollection, handleCreateRequest,
    handleDeleteCollection, handleDeleteRequest, handleDuplicateRequest,
    handleRenameCollection, handleRenameRequest,
    handleCreateExample, handleDuplicateExample, handleSaveAsExample,
    handleRenameExample, handleSelectRequest, handleOpenExample,
    handleSidebarDeleteExample, handleImport, handleExportCollection,
    handleImportCurl, handleTryExample,
    showConflictModal, setShowConflictModal, pendingSaveTabId,
    handleOverwriteConflict, handleDiscardChanges,
    handleSaveRequest, handleSaveExample, handleSendRequest, cancelRequest,
    updateTabRequest, updateTabExample, initCollectionTab, updateTabCollection,
    handleSaveCollection, updateActiveDetailTab, wasRecentlyModified,
    workflows, setWorkflows, loadWorkflows, openWorkflowInTab, openDocsInTab,
    updateTabWorkflow, handleSaveWorkflow,
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
