import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Copy, X } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { EditorView } from '@codemirror/view';
import { AuthCallback } from './components/AuthCallback';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { RequestEditor, generateCurl } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { AppModals } from './components/AppModals';
import { CollectionEditor } from './components/CollectionEditor';
import { CollectionDocs } from './components/CollectionDocs';
import { WorkflowEditor } from './components/WorkflowEditor';
import { VariablePopoverProvider } from './components/VariablePopover';
import { AppHeader } from './components/AppHeader';
import { TabBar } from './components/TabBar';
import { useToast } from './components/Toast';
import { useConfirm } from './components/ConfirmModal';
import { usePrompt } from './components/PromptModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WorkbenchProvider, useWorkbench } from './contexts/WorkbenchContext';
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext';
import { useWebSocket } from './hooks/useWebSocket';
import { useLayoutState } from './hooks/useLayoutState';
import { useVersionCheck } from './hooks/useVersionCheck';
import * as data from './data/index.js';
import './App.css';
import './styles/sidebar.css';
import './styles/request-editor.css';
import './styles/response-viewer.css';
import './styles/variables.css';
import './styles/modals.css';
import './styles/workspace-settings.css';
import './styles/user-management.css';
import './styles/environment-editor.css';
import './styles/presence-avatars.css';
import './styles/workflow-editor.css';
import './styles/collection-docs.css';

import { METHOD_COLORS } from './constants/methodColors';

function sortRequests(requests) {
  return [...requests].sort((a, b) => {
    const sortA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const sortB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (sortA !== sortB) return sortA - sortB;
    return (a.created_at || 0) - (b.created_at || 0);
  });
}

function upsertCollectionInState(collections, collection) {
  const existing = collections.find((item) => item.id === collection.id);
  const nextCollection = {
    ...existing,
    ...collection,
    requests: existing?.requests || [],
  };

  if (existing) {
    return collections.map((item) => (item.id === collection.id ? nextCollection : item));
  }

  return [...collections, nextCollection].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
}

function removeCollectionBranch(collections, collectionId) {
  const idsToRemove = new Set([collectionId]);
  let changed = true;

  while (changed) {
    changed = false;
    collections.forEach((collection) => {
      if (collection.parent_id && idsToRemove.has(collection.parent_id) && !idsToRemove.has(collection.id)) {
        idsToRemove.add(collection.id);
        changed = true;
      }
    });
  }

  return collections.filter((collection) => !idsToRemove.has(collection.id));
}

function upsertRequestInState(collections, request) {
  let existingRequest = null;

  const collectionsWithoutRequest = collections.map((collection) => ({
    ...collection,
    requests: (collection.requests || []).filter((item) => {
      if (item.id === request.id) {
        existingRequest = item;
        return false;
      }
      return true;
    }),
  }));

  return collectionsWithoutRequest.map((collection) => {
    if (collection.id !== request.collection_id) {
      return collection;
    }

    const nextRequest = {
      ...existingRequest,
      ...request,
      example_count: request.example_count ?? existingRequest?.example_count ?? 0,
    };

    return {
      ...collection,
      requests: sortRequests([...(collection.requests || []), nextRequest]),
    };
  });
}

function removeRequestFromState(collections, requestId) {
  return collections.map((collection) => ({
    ...collection,
    requests: (collection.requests || []).filter((request) => request.id !== requestId),
  }));
}

function patchRequestInState(collections, requestId, updater) {
  return collections.map((collection) => ({
    ...collection,
    requests: (collection.requests || []).map((request) => (
      request.id === requestId ? updater(request) : request
    )),
  }));
}

function upsertExampleInList(examples, example) {
  const existing = examples.find((item) => item.id === example.id);
  if (existing) {
    return examples.map((item) => (item.id === example.id ? { ...item, ...example } : item));
  }

  return [example, ...examples].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

const curlEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    height: '100%',
  },
  '.cm-content': {
    padding: '14px 4px',
    caretColor: 'transparent',
  },
  '.cm-cursor': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '28px',
    fontSize: '11px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(59, 130, 246, 0.2) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(59, 130, 246, 0.3) !important' },
});

const curlLightSyntax = EditorView.theme({
  '.ͼd': { color: '#16a34a' },  // strings
  '.ͼc': { color: '#d97706' },  // numbers
  '.ͼb': { color: '#0284c7' },  // keywords (curl, flags)
  '.ͼe': { color: '#7c3aed' },  // builtins
});

const curlDarkSyntax = EditorView.theme({
  '.ͼd': { color: '#4ade80' },  // strings
  '.ͼc': { color: '#fbbf24' },  // numbers
  '.ͼb': { color: '#38bdf8' },  // keywords
  '.ͼe': { color: '#a78bfa' },  // builtins
});

const shellLang = StreamLanguage.define(shell);

function AppContent() {
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [showImportCurl, setShowImportCurl] = useState(false);
  const [draftSavePending, setDraftSavePending] = useState(null);
  const [tempCloseTabId, setTempCloseTabId] = useState(null);
  const [dirtyCloseTabId, setDirtyCloseTabId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [userConfig, setUserConfig] = useState({});
  const toast = useToast();
  const { updateAvailable, tauriUpdate, downloading, downloadProgress, installUpdate, isTauri } = useVersionCheck();

  const {
    theme,
    handleThemeChange,
    sidebarWidth,
    requestEditorHeight,
    startResizing,
    startResizingVertical,
    mainContentRef,
    showCurlPanel,
    curlPanelWidth,
    startResizingCurl,
    toggleCurlPanel,
  } = useLayoutState();

  const userRef = useRef(null);
  const closeBehaviorRef = useRef(null);
  const {
    user,
    authChecked,
    handleLogin,
    handleLogout,
  } = useAuth();

  // Load user config (theme, preferences) after auth
  useEffect(() => {
    if (!user) return;
    data.getUserConfig().then((config) => {
      setUserConfig(config);
      if (config.theme) {
        handleThemeChange(config.theme);
      }
      if (config.closeBehavior) {
        syncCloseBehaviorToRust(config.closeBehavior);
      }
    }).catch(() => {});
  }, [user, handleThemeChange]);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { closeBehaviorRef.current = userConfig.closeBehavior; }, [userConfig]);

  // Listen for Tauri close-requested event (when no preference is saved)
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let unlisten;
    let cancelled = false;
    import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return;
      listen('close-requested', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        if (!userRef.current) {
          await invoke('close_app');
        } else {
          const behavior = closeBehaviorRef.current;
          if (behavior === 'tray') {
            await invoke('hide_window');
          } else if (behavior === 'close') {
            await invoke('close_app');
          } else {
            setShowCloseModal(true);
          }
        }
      }).then(fn => { if (!cancelled) unlisten = fn; else fn(); });
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  const {
    activeWorkspace,
    workspaces,
    showWorkspaceSettings,
    setShowWorkspaceSettings,
    showUserManagement,
    setShowUserManagement,
    userProfile,
    allUsers,
    allWorkspaces,
    workspacesLoading,
    usersLoading,
    handleWorkspaceChange,
    handleCreateWorkspace,
    handleOpenWorkspaceSettings,
    handleUpdateWorkspace,
    handleDeleteWorkspace,
    handleInviteUser,
    handleUpdateUser,
    handleUpdateUserWorkspaces,
    handleDeleteUser,
  } = useWorkspace();

  const {
    openTabs,
    setOpenTabs,
    activeTabId,
    setActiveTabId,
    conflictedTabs,
    setConflictedTabs,
    deletedTabs,
    setDeletedTabs,
    previewTabId,
    pendingRequestIds,
    pendingExampleIds,
    pendingExampleListRequestIds,
    pendingCollectionIds,
    revealRequestId,
    setRevealRequestId,
    revealCollectionId,
    setRevealCollectionId,
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
    activeEnvironment,
    setActiveEnvironment,
    loadCollections,
    loadEnvironments,
    loading,
    closeTab,
    handleCreateCollection,
    handleCreateSubCollection,
    handleCreateRequest,
    handleDeleteCollection,
    handleDeleteRequest,
    handleDuplicateRequest,
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
    cancelRequest,
    updateTabRequest,
    updateTabExample,
    initCollectionTab,
    updateTabCollection,
    handleSaveCollection,
    updateActiveDetailTab,
    wasRecentlyModified,
    openCollectionInTab,
    openRequestInTab,
    openExampleInTab,
    saveFunctionsRef,
    workflows,
    loadWorkflows,
    openWorkflowInTab,
    openDocsInTab,
    updateTabWorkflow,
    handleSaveWorkflow,
  } = useWorkbench();

  const lastClipboardLinkRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    const pattern = new RegExp(
      `^${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\?.*type=(collection|folder|request|example)&id=([0-9a-f-]+)`
    );

    const handleFocus = async () => {
      let text;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return;
      }
      if (!text) return;
      const match = text.match(pattern);
      if (!match) return;
      const type = match[1];
      const id = match[2];

      const urlParams = new URLSearchParams(text.split('?')[1]);
      const uid = urlParams.get('uid');
      if (uid && uid === String(user.id)) return;

      if (text === lastClipboardLinkRef.current) return;
      lastClipboardLinkRef.current = text;

      if (type === 'collection' || type === 'folder') {
        const found = collections.find(c => c.id === id);
        if (!found) return;
        toast.action(`Open shared ${type}?`, {
          label: 'Open',
          onClick: () => {
            openCollectionInTab(found, { replacePreview: false });
            setRevealCollectionId(id);
          },
        });
      } else if (type === 'request') {
        let request = null;
        for (const c of collections) {
          request = c.requests?.find(r => r.id === id);
          if (request) break;
        }
        if (!request) return;
        toast.action('Open shared request?', {
          label: 'Open',
          onClick: async () => {
            const fullRequest = await data.getRequest(id);
            openRequestInTab(fullRequest, { replacePreview: false });
            setRevealRequestId(id);
          },
        });
      } else if (type === 'example') {
        toast.action('Open shared example?', {
          label: 'Open',
          onClick: async () => {
            try {
              const example = await data.getExample(id);
              const parentRequest = await data.getRequest(example.request_id);
              openExampleInTab(example, parentRequest, { replacePreview: false });
              setRevealRequestId(parentRequest.id);
            } catch {
              toast.error('Failed to open shared example.');
            }
          },
        });
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user, collections, toast, openCollectionInTab, openRequestInTab, openExampleInTab, setRevealCollectionId, setRevealRequestId]);

  const canEdit = ['system', 'admin', 'developer'].includes(userProfile?.role);

  // Load collection variables for the active request/collection's root collection
  const [collectionVariables, setCollectionVariables] = useState([]);

  const activeCollectionId = useMemo(() => {
    if (activeTab?.type === 'collection') return activeTab.collection?.id;
    if (selectedRequest?.collection_id) return selectedRequest.collection_id;
    return null;
  }, [activeTab?.type, activeTab?.collection?.id, selectedRequest?.collection_id]);

  const rootCollectionId = useMemo(() => {
    if (!activeCollectionId || !collections) return null;
    let currentId = activeCollectionId;
    let iterations = 0;
    while (currentId && iterations < 50) {
      const col = collections.find(c => c.id === currentId);
      if (!col) break;
      if (!col.parent_id) return col.id;
      currentId = col.parent_id;
      iterations++;
    }
    return currentId;
  }, [activeCollectionId, collections]);

  const reloadCollectionVariables = useCallback(() => {
    if (!rootCollectionId) return;
    data.getCollectionVariables(rootCollectionId).then(setCollectionVariables).catch(() => setCollectionVariables([]));
  }, [rootCollectionId]);

  useEffect(() => {
    if (!rootCollectionId) { setCollectionVariables([]); return; }
    reloadCollectionVariables();
  }, [rootCollectionId, reloadCollectionVariables]);

  const curlPreview = useMemo(() => {
    if (!showCurlPanel) return '';
    const req = activeTab?.type === 'example'
      ? selectedExample?.request_data
      : selectedRequest;
    if (!req) return '';
    const sub = (text) => {
      if (!text || !activeEnvironment) return text;
      let result = text;
      for (const v of activeEnvironment.variables) {
        if (v.enabled && v.key) {
          result = result.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, 'g'), v.value || '');
        }
      }
      return result;
    };
    const headers = (req.headers || []).map(h => ({ ...h, key: sub(h.key), value: sub(h.value) }));
    const fd = (req.form_data || []).map(f => ({ ...f, key: sub(f.key), value: f.type === 'file' ? f.value : sub(f.value) }));
    return generateCurl(
      req.method || 'GET',
      sub(req.url || ''),
      headers,
      sub(req.body || ''),
      req.body_type || 'none',
      fd,
      req.auth_type || 'none',
      sub(req.auth_token || '')
    );
  }, [showCurlPanel, selectedRequest, selectedExample, activeTab?.type, activeEnvironment]);

  // Register temp request save handler for Ctrl+S
  useEffect(() => {
    saveFunctionsRef.current.handleSaveTempRequest = (tab) => {
      setDraftSavePending({ tabId: tab.id, requestData: tab.request || {} });
    };
    return () => { saveFunctionsRef.current.handleSaveTempRequest = null; };
  }, [saveFunctionsRef]);

  const handleTabsWheel = useCallback((event) => {
    const tabBar = event.currentTarget;
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    if (delta === 0) return;
    event.preventDefault();
    tabBar.scrollLeft += delta;
  }, []);

  const handleCopyLink = useCallback(async (type, id) => {
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    const url = `${baseUrl}/?type=${type}&id=${id}${user?.id ? `&uid=${user.id}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard.');
    } catch (error) {
      toast.error('Failed to copy link.');
    }
  }, [toast, user]);

  const handleWebSocketMessage = useCallback(
    (message) => {
      const { event, data: payload } = message;

      if (event === 'request:update' && payload?.id) {
        const tabId = `request-${payload.id}`;
        // Check if this is our own save or rename (ignore it)
        if (wasRecentlyModified(tabId)) {
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
        }
      }

      if (event === 'request:create' && payload?.id) {
        const tabId = `request-${payload.id}`;
        if (wasRecentlyModified(tabId)) {
          return;
        }
      }

      if (event === 'example:update' && payload?.id) {
        const tabId = `example-${payload.id}`;
        // Check if this is our own save or rename (ignore it)
        if (wasRecentlyModified(tabId)) {
          return;
        }

        // Check if this example is open in any tab
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          setConflictedTabs(prev => ({
            ...prev,
            [tabId]: payload
          }));
        }
      }

      if (event === 'example:create' && payload?.id) {
        const tabId = `example-${payload.id}`;
        if (wasRecentlyModified(tabId)) {
          return;
        }
      }

      // Handle request deletion - mark open tabs as deleted
      if (event === 'request:delete' && payload?.id) {
        const tabId = `request-${payload.id}`;
        if (wasRecentlyModified(tabId)) {
          return;
        }
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          setDeletedTabs(prev => new Set([...prev, tabId]));
        }
      }

      // Handle example deletion - mark open tabs as deleted
      if (event === 'example:delete' && payload?.id) {
        const tabId = `example-${payload.id}`;
        if (wasRecentlyModified(tabId)) {
          return;
        }
        const openTab = openTabs.find(t => t.id === tabId);
        if (openTab) {
          setDeletedTabs(prev => new Set([...prev, tabId]));
        }
      }

      // Check if this is our own collection modification (skip reload)
      if (
        (event === 'collection:create' || event === 'collection:update' || event === 'collection:delete') &&
        payload?.id &&
        wasRecentlyModified(`collection-${payload.id}`)
      ) {
        return;
      }

      // Check if this is our own request modification (skip reload)
      if (
        (event === 'request:create' || event === 'request:update' || event === 'request:delete') &&
        payload?.id &&
        wasRecentlyModified(`request-${payload.id}`)
      ) {
        return;
      }

      // Check if this is our own example modification (skip reload)
      // Examples are deleted when their parent request is deleted
      if (
        (event === 'example:create' || event === 'example:update' || event === 'example:delete') &&
        payload?.id &&
        wasRecentlyModified(`example-${payload.id}`)
      ) {
        return;
      }

      // Also skip example events if the parent request was recently modified (cascade delete)
      if (
        (event === 'example:delete') &&
        payload?.request_id &&
        wasRecentlyModified(`request-${payload.request_id}`)
      ) {
        return;
      }

      // Check if this is our own import (skip reload)
      if (event === 'sync:import' && payload?.rootCollectionId && wasRecentlyModified(`collection-${payload.rootCollectionId}`)) {
        return;
      }

      // Handle delete events by updating state directly (no reload needed)
      if (event === 'collection:delete' && payload?.id) {
        setCollections(prev => removeCollectionBranch(prev, payload.id));
        return;
      }

      if (event === 'request:delete' && payload?.id) {
        setCollections(prev => removeRequestFromState(prev, payload.id));
        return;
      }

      if (event === 'collection:create' && payload?.id) {
        setCollections(prev => upsertCollectionInState(prev, payload));
        return;
      }

      if (event === 'collection:update' && payload?.id) {
        setCollections(prev => upsertCollectionInState(prev, payload));
        return;
      }

      if ((event === 'request:create' || event === 'request:update' || event === 'request:move') && payload?.id) {
        data.getRequest(payload.id)
          .then((request) => {
            setCollections(prev => upsertRequestInState(prev, request));
          })
          .catch((error) => {
            console.error(`Failed to sync websocket ${event}:`, error);
          });
        return;
      }

      if (event === 'request:reorder' && payload?.id) {
        data.getRequest(payload.id)
          .then((request) => {
            setCollections(prev => upsertRequestInState(prev, request));
          })
          .catch((error) => {
            console.error('Failed to sync websocket request reorder:', error);
          });
        return;
      }

      if (event === 'example:create' && payload?.id) {
        const syncExampleCreate = async () => {
          try {
            const example = payload.request_id ? payload : await data.getExample(payload.id);
            const fullExample = example.request_data ? example : await data.getExample(example.id);

            setCollections(prev => patchRequestInState(prev, example.request_id, (request) => ({
              ...request,
              example_count: (request.example_count || 0) + 1,
            })));

            if (selectedRequest?.id === fullExample.request_id) {
              setExamples(prev => upsertExampleInList(prev, fullExample));
            }
          } catch (error) {
            console.error('Failed to sync websocket example create:', error);
          }
        };

        syncExampleCreate();
        return;
      }

      if (event === 'example:update' && payload?.id) {
        const syncExampleUpdate = async () => {
          try {
            const example = await data.getExample(payload.id);

            setCollections(prev => patchRequestInState(prev, example.request_id, (request) => ({
              ...request,
            })));

            if (selectedRequest?.id === example.request_id) {
              setExamples(prev => upsertExampleInList(prev, example));
            }
          } catch (error) {
            console.error('Failed to sync websocket example update:', error);
          }
        };

        syncExampleUpdate();
        return;
      }

      if (event === 'example:delete' && payload?.id) {
        const deletedExampleRequestId =
          payload.request_id
          || examples.find((example) => example.id === payload.id)?.request_id
          || openTabs.find((tab) => tab.id === `example-${payload.id}`)?.parentRequestId
          || null;

        if (deletedExampleRequestId) {
          setCollections(prev => patchRequestInState(prev, deletedExampleRequestId, (request) => ({
            ...request,
            example_count: Math.max(0, (request.example_count || 0) - 1),
          })));
        }

        setExamples(prev => prev.filter((example) => example.id !== payload.id));

        return;
      }

      if (event === 'sync:import') {
        loadCollections();
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
        // Environments are now workspace-scoped
        if (activeWorkspace?.id) {
          loadEnvironments(activeWorkspace.id);
        }
      }

      // Workflow realtime events
      if (event?.startsWith('workflow:')) {
        loadWorkflows();
        if (event === 'workflow:DELETE' && payload?.id) {
          const tabId = `workflow-${payload.id}`;
          const openTab = openTabs.find(t => t.id === tabId);
          if (openTab) setDeletedTabs(prev => new Set([...prev, tabId]));
        }
      }
    },
    [activeWorkspace?.id, examples, loadCollections, loadEnvironments, loadWorkflows, openTabs, selectedRequest?.id, setCollections, setExamples, wasRecentlyModified]
  );

  useWebSocket(handleWebSocketMessage);

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

  // Show deep link auth error as toast once auth check completes
  useEffect(() => {
    if (!authChecked) return;
    if (window.__DEEP_LINK_AUTH_ERROR__) {
      toast.error(`Sign in failed: ${window.__DEEP_LINK_AUTH_ERROR__}`);
      delete window.__DEEP_LINK_AUTH_ERROR__;
    }
  }, [authChecked, toast]);

  // Show spinner while checking auth via deep link in desktop app
  if (!authChecked) {
    if ('__TAURI_INTERNALS__' in window && window.__DEEP_LINK_AUTH__) {
      return (
        <div className="deeplink-auth-loader">
          <div className="loading-spinner" />
          <p>Signing in...</p>
        </div>
      );
    }
    return null;
  }

  // Show auth callback page (deep link handoff to desktop app)
  if (window.location.pathname === '/auth/callback') {
    return <AuthCallback />;
  }

  // Show login if not authenticated
  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <VariablePopoverProvider
      activeEnvironment={activeEnvironment}
      collectionVariables={collectionVariables}
      rootCollectionId={rootCollectionId}
      onEnvironmentUpdate={() => { activeWorkspace?.id && loadEnvironments(activeWorkspace.id); reloadCollectionVariables(); }}
    >
    <div className="app">
      {updateAvailable && (
        <div className="version-toast">
          {isTauri && tauriUpdate ? (
            <>
              <span>Update available: v{tauriUpdate.version}</span>
              {downloading ? (
                <span className="update-progress">{downloadProgress}%</span>
              ) : (
                <button onClick={installUpdate}>Install &amp; Restart</button>
              )}
            </>
          ) : (
            <>
              <span>New version available</span>
              <button onClick={() => window.location.reload()}>Refresh</button>
            </>
          )}
        </div>
      )}
      <AppHeader
        user={user}
        userProfile={userProfile}
        userConfig={userConfig}
        setUserConfig={setUserConfig}
        theme={theme}
        handleThemeChange={handleThemeChange}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        workspacesLoading={workspacesLoading}
        handleWorkspaceChange={handleWorkspaceChange}
        handleCreateWorkspace={handleCreateWorkspace}
        handleOpenWorkspaceSettings={handleOpenWorkspaceSettings}
        environments={environments}
        activeEnvironment={activeEnvironment}
        loadEnvironments={loadEnvironments}
        canEdit={canEdit}
        handleImport={handleImport}
        openTabs={openTabs}
        activeTab={activeTab}
        setShowEnvEditor={setShowEnvEditor}
        setShowImportCurl={setShowImportCurl}
        setShowUserManagement={setShowUserManagement}
        setShowSettings={setShowSettings}
        setShowAbout={setShowAbout}
        handleLogout={handleLogout}
      />

      <div className="app-body">
        <Sidebar
          collections={collections}
          selectedRequest={selectedRequest}
          activeTab={activeTab}
          onSelectRequest={handleSelectRequest}
          onOpenCollection={openCollectionInTab}
          onCreateCollection={handleCreateCollection}
          onCreateSubCollection={handleCreateSubCollection}
          onCreateRequest={handleCreateRequest}
          onDeleteCollection={handleDeleteCollection}
          onDeleteRequest={handleDeleteRequest}
          onDuplicateRequest={handleDuplicateRequest}
          onExportCollection={handleExportCollection}
          onRenameCollection={handleRenameCollection}
          onRenameRequest={handleRenameRequest}
          width={sidebarWidth}
          onOpenExample={handleOpenExample}
          onCreateExample={handleCreateExample}
          onDeleteExample={handleSidebarDeleteExample}
          onDuplicateExample={handleDuplicateExample}
          onRenameExample={handleRenameExample}
          onCopyLink={handleCopyLink}
          pendingRequestIds={pendingRequestIds}
          pendingExampleIds={pendingExampleIds}
          pendingExampleListRequestIds={pendingExampleListRequestIds}
          pendingCollectionIds={pendingCollectionIds}
          canAddCollection={!!activeWorkspace}
          canEdit={canEdit}
          selectedExample={selectedExample}
          loading={collectionsLoading}
          revealRequestId={revealRequestId}
          revealCollectionId={revealCollectionId}
          onRevealComplete={() => { setRevealRequestId(null); setRevealCollectionId(null); }}
          workflows={workflows}
          onOpenWorkflow={openWorkflowInTab}
          onCreateWorkflow={async (collectionId) => {
            try {
              const wf = await data.createWorkflow({ collection_id: collectionId });
              await loadWorkflows();
              openWorkflowInTab(wf);
            } catch (err) { toast.error('Failed to create workflow'); }
          }}
          onDeleteWorkflow={async (wf) => {
            try {
              await data.deleteWorkflow(wf.id);
              loadWorkflows();
              const tabId = `workflow-${wf.id}`;
              setOpenTabs(prev => prev.filter(t => t.id !== tabId));
              if (activeTabId === tabId) setActiveTabId(openTabs[0]?.id || null);
              toast.success('Workflow deleted');
            } catch (err) { toast.error('Failed to delete workflow'); }
          }}
          onDuplicateWorkflow={async (wf) => {
            try {
              const dup = await data.createWorkflow({
                collection_id: wf.collection_id,
                name: wf.name + ' (copy)',
                steps: wf.steps || [],
              });
              await loadWorkflows();
              openWorkflowInTab(dup);
            } catch (err) { toast.error('Failed to duplicate workflow'); }
          }}
          onRenameWorkflow={async (id, name) => {
            if (!name) return;
            try {
              await data.updateWorkflow(id, { name });
              loadWorkflows();
              setOpenTabs(prev => prev.map(t =>
                t.id === `workflow-${id}` ? { ...t, workflow: { ...t.workflow, name } } : t
              ));
            } catch (err) { toast.error('Failed to rename workflow'); }
          }}
          onRunWorkflow={async (wf) => {
            await openWorkflowInTab(wf, { replacePreview: false });
            setOpenTabs(prev => prev.map(t =>
              t.id === `workflow-${wf.id}` ? { ...t, pendingRun: true } : t
            ));
          }}
          onViewDocs={(collection) => openDocsInTab(collection)}
        />
        <div
          className="sidebar-resize-handle"
          onMouseDown={startResizing}
        />
        <main className="main-content" ref={mainContentRef}>
          <TabBar
            openTabs={openTabs}
            activeTabId={activeTabId}
            setActiveTabId={setActiveTabId}
            setOpenTabs={setOpenTabs}
            previewTabId={previewTabId}
            conflictedTabs={conflictedTabs}
            deletedTabs={deletedTabs}
            closeTab={closeTab}
            canEdit={canEdit}
            activeWorkspace={activeWorkspace}
            userConfig={userConfig}
            setTempCloseTabId={setTempCloseTabId}
            setDirtyCloseTabId={setDirtyCloseTabId}
            onWheel={handleTabsWheel}
          />

          {activeTab?.type === 'docs' ? (
            <CollectionDocs
              collectionId={activeTab.docs?.collectionId}
              collectionName={activeTab.docs?.collectionName}
              cachedData={activeTab.docsCache}
              onCacheUpdate={(cache) => {
                setOpenTabs(prev => prev.map(t =>
                  t.id === activeTabId ? { ...t, docsCache: cache } : t
                ));
              }}
            />
          ) : activeTab?.type === 'workflow' ? (
            <WorkflowEditor
              workflow={activeTab.workflow}
              onWorkflowChange={(updates) => updateTabWorkflow(updates)}
              onSave={async () => {
                try {
                  await handleSaveWorkflow();
                  toast.success('Workflow saved');
                } catch (err) {
                  toast.error(err.message || 'Failed to save workflow');
                }
              }}
              dirty={activeTab.dirty}
              canEdit={canEdit}
              collections={collections}
              activeEnvironment={activeEnvironment}
              runState={activeTab.runState}
              onRunStateChange={(rs) => {
                setOpenTabs(prev => prev.map(t =>
                  t.id === activeTabId ? { ...t, runState: rs } : t
                ));
              }}
              pendingRun={activeTab.pendingRun}
              onClearPendingRun={() => {
                setOpenTabs(prev => prev.map(t =>
                  t.id === activeTabId ? { ...t, pendingRun: false } : t
                ));
              }}
              onOpenRequest={(req) => openRequestInTab(req, { replacePreview: false })}
              openTabs={openTabs}
              setActiveEnvironment={setActiveEnvironment}
            />
          ) : activeTab?.type === 'collection' ? (
            <CollectionEditor
              collection={activeTab.collection}
              activeDetailTab={activeTab.activeDetailTab || 'overview'}
              onActiveDetailTabChange={updateActiveDetailTab}
              onCollectionChange={(updates, isInit) => {
                if (isInit) {
                  initCollectionTab(activeTab.id, updates);
                } else {
                  updateTabCollection(updates);
                }
              }}
              canEdit={canEdit}
              dirty={activeTab.dirty}
              onSave={async () => {
                try {
                  await handleSaveCollection();
                  toast.success(activeTab.collection?.parent_id ? 'Folder saved' : 'Collection saved');
                } catch (err) {
                  toast.error(err.message || (activeTab.collection?.parent_id ? 'Failed to save folder' : 'Failed to save collection'));
                }
              }}
              activeEnvironment={activeEnvironment}
              collectionVariables={collectionVariables}
              rootCollectionId={rootCollectionId}
              onEnvironmentUpdate={() => { activeWorkspace?.id && loadEnvironments(activeWorkspace.id); reloadCollectionVariables(); }}
            />
          ) : (
            <>
              <RequestEditor
                request={selectedRequest}
                example={selectedExample}
                isExample={activeTab?.type === 'example'}
                onSend={handleSendRequest}
                onCancel={cancelRequest}
                onSave={activeTab?.isTemporary
                  ? (requestData) => setDraftSavePending({ tabId: activeTabId, requestData: { ...activeTab.request, ...requestData } })
                  : (activeTab?.type === 'example' ? handleSaveExample : handleSaveRequest)}
                onSaveAsExample={handleSaveAsExample}
                onTry={handleTryExample}
                onRequestChange={activeTab?.type === 'example' ? updateTabExample : updateTabRequest}
                loading={loading}
                response={response}
                dirty={activeTab?.dirty}
                isTemporary={activeTab?.isTemporary}
                activeEnvironment={activeEnvironment}
                collectionVariables={collectionVariables}
                rootCollectionId={rootCollectionId}
                onEnvironmentUpdate={() => { activeWorkspace?.id && loadEnvironments(activeWorkspace.id); reloadCollectionVariables(); }}
                height={requestEditorHeight}
                activeDetailTab={activeTab?.activeDetailTab || 'params'}
                onActiveDetailTabChange={updateActiveDetailTab}
                canEdit={canEdit}
                showCurlPanel={showCurlPanel}
                onToggleCurlPanel={toggleCurlPanel}
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
                requestUrl={activeTab?.type === 'example' ? null : (activeTab?.request?.url || selectedRequest?.url)}
              />
            </>
          )}
        </main>

        {showCurlPanel && (
          <>
            <div
              className="curl-resize-handle"
              onMouseDown={startResizingCurl}
            />
            <aside className="curl-panel" style={{ width: curlPanelWidth }}>
              <div className="curl-panel-header">
                <span className="curl-panel-title">cURL</span>
                <div className="curl-panel-actions">
                <button
                  className="btn-icon small"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(curlPreview);
                      toast.success('cURL copied to clipboard');
                    } catch {
                      const textArea = document.createElement('textarea');
                      textArea.value = curlPreview;
                      textArea.style.position = 'fixed';
                      textArea.style.left = '-9999px';
                      document.body.appendChild(textArea);
                      textArea.select();
                      document.execCommand('copy');
                      document.body.removeChild(textArea);
                      toast.success('cURL copied to clipboard');
                    }
                  }}
                  title="Copy to clipboard"
                >
                  <Copy size={14} />
                </button>
                <button
                  className="btn-icon small"
                  onClick={toggleCurlPanel}
                  title="Close panel"
                >
                  <X size={14} />
                </button>
                </div>
              </div>
              <div className="curl-panel-code">
                <CodeMirror
                  value={curlPreview}
                  readOnly
                  editable={false}
                  theme={theme === 'dark' ? 'dark' : 'light'}
                  extensions={[
                    shellLang,
                    curlEditorTheme,
                    theme === 'dark' ? curlDarkSyntax : curlLightSyntax,
                    EditorView.lineWrapping,
                  ]}
                  basicSetup={{
                    lineNumbers: true,
                    highlightActiveLineGutter: false,
                    highlightActiveLine: false,
                    foldGutter: false,
                    bracketMatching: false,
                    closeBrackets: false,
                    autocompletion: false,
                    indentOnInput: false,
                    searchKeymap: false,
                  }}
                />
              </div>
            </aside>
          </>
        )}

      </div>

      <AppModals
        showEnvEditor={showEnvEditor} setShowEnvEditor={setShowEnvEditor}
        activeWorkspace={activeWorkspace} loadEnvironments={loadEnvironments} canEdit={canEdit}
        showWorkspaceSettings={showWorkspaceSettings} setShowWorkspaceSettings={setShowWorkspaceSettings}
        handleUpdateWorkspace={handleUpdateWorkspace} handleDeleteWorkspace={handleDeleteWorkspace} userProfile={userProfile}
        showUserManagement={showUserManagement} setShowUserManagement={setShowUserManagement}
        allUsers={allUsers} allWorkspaces={allWorkspaces} user={user}
        handleInviteUser={handleInviteUser} handleUpdateUser={handleUpdateUser}
        handleUpdateUserWorkspaces={handleUpdateUserWorkspaces} handleDeleteUser={handleDeleteUser} usersLoading={usersLoading}
        showCloseModal={showCloseModal} setShowCloseModal={setShowCloseModal}
        userConfig={userConfig} setUserConfig={setUserConfig}
        showAbout={showAbout} setShowAbout={setShowAbout}
        updateAvailable={updateAvailable} tauriUpdate={tauriUpdate}
        downloading={downloading} downloadProgress={downloadProgress} installUpdate={installUpdate}
        showSettings={showSettings} setShowSettings={setShowSettings}
        handleThemeChange={handleThemeChange} toast={toast}
        showImportCurl={showImportCurl} setShowImportCurl={setShowImportCurl} handleImportCurl={handleImportCurl}
        draftSavePending={draftSavePending} setDraftSavePending={setDraftSavePending}
        collections={collections} setCollections={setCollections}
        openTabs={openTabs} setOpenTabs={setOpenTabs} activeTabId={activeTabId} setActiveTabId={setActiveTabId}
        openRequestInTab={openRequestInTab}
        tempCloseTabId={tempCloseTabId} setTempCloseTabId={setTempCloseTabId}
        dirtyCloseTabId={dirtyCloseTabId} setDirtyCloseTabId={setDirtyCloseTabId}
        closeTab={closeTab} handleSaveRequest={handleSaveRequest} handleSaveExample={handleSaveExample}
        showConflictModal={showConflictModal} setShowConflictModal={setShowConflictModal}
        pendingSaveTabId={pendingSaveTabId} deletedTabs={deletedTabs}
        handleDiscardChanges={handleDiscardChanges} handleOverwriteConflict={handleOverwriteConflict}
      />
    </div>
    </VariablePopoverProvider>
  );
}

function App() {
  const toast = useToast();
  const prompt = usePrompt();
  const confirm = useConfirm();

  return (
    <AuthProvider>
      <WorkspaceProvider prompt={prompt} toast={toast}>
        <WorkbenchProvider prompt={prompt} confirm={confirm} toast={toast}>
          <AppContent />
        </WorkbenchProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}

export default App;
