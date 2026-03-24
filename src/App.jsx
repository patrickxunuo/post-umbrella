import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Terminal, AlertTriangle, X, Shield, UserPlus, LogOut, ChevronDown, Monitor, Plus, Settings, Copy, Info } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { EditorView } from '@codemirror/view';
import { WindowControls } from './components/WindowControls';
import { AuthCallback } from './components/AuthCallback';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { RequestEditor, generateCurl } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { ImportDropdown } from './components/ImportDropdown';
import { EnvironmentEditor } from './components/EnvironmentEditor';
import { EnvironmentSelector } from './components/EnvironmentSelector';
import { WorkspaceSelector } from './components/WorkspaceSelector';
import { WorkspacePresenceAvatars } from './components/WorkspacePresenceAvatars';
import { WorkspaceSettings } from './components/WorkspaceSettings';
import { UserManagement } from './components/UserManagement';
import { InviteUserModal } from './components/InviteUserModal';
import { ImportCurlModal } from './components/ImportCurlModal';
import { ThemeToggle } from './components/ThemeToggle';
import { FolderPickerModal } from './components/FolderPicker';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';
import { SettingsModal, syncCloseBehaviorToRust } from './components/SettingsModal';
import { AboutModal } from './components/AboutModal';
import { CloseToTrayModal } from './components/CloseToTrayModal';
import { CollectionEditor } from './components/CollectionEditor';
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
import './styles/workspace-settings.css';
import './styles/user-management.css';
import './styles/environment-editor.css';
import './styles/presence-avatars.css';

const METHOD_COLORS = {
  GET: '#10b981',
  POST: '#f59e0b',
  PUT: '#3b82f6',
  PATCH: '#8b5cf6',
  DELETE: '#ef4444',
  HEAD: '#06b6d4',
  OPTIONS: '#64748b',
};

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
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [draggingTabId, setDraggingTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);
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
    },
    [activeWorkspace?.id, examples, loadCollections, loadEnvironments, openTabs, selectedRequest?.id, setCollections, setExamples, wasRecentlyModified]
  );

  useWebSocket(handleWebSocketMessage);

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
      <header className="app-header" data-tauri-drag-region>
        <div className="header-left">
          <div className="app-title">
            <img src="/umbrella.svg" alt="" className="app-logo" />
            <h1>Post Umbrella</h1>
          </div>
          <WorkspaceSelector
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            onWorkspaceChange={handleWorkspaceChange}
            onCreateWorkspace={handleCreateWorkspace}
            onOpenSettings={handleOpenWorkspaceSettings}
            canCreateWorkspace={['system', 'admin'].includes(userProfile?.role)}
            canOpenSettings={['system', 'admin'].includes(userProfile?.role)}
            loading={workspacesLoading}
          />
        </div>
        <div className="header-right">
          <ThemeToggle theme={theme} onToggle={(t) => {
            handleThemeChange(t);
            if (user) {
              const next = { ...userConfig, theme: t };
              setUserConfig(next);
              data.updateUserConfig({ theme: t }).catch(() => {});
            }
          }} />
          <EnvironmentSelector
            environments={environments}
            activeEnvironment={activeEnvironment}
            onEnvironmentChange={() => activeWorkspace?.id && loadEnvironments(activeWorkspace.id)}
            onOpenEditor={() => setShowEnvEditor(true)}
            workspaceId={activeWorkspace?.id}
          />
          {canEdit && (
            <ImportDropdown
              onImportCurl={() => setShowImportCurl(true)}
              onImportFile={handleImport}
              disabled={!activeWorkspace}
            />
          )}
          <div className="header-presence-group">
            {canEdit && (
              <button
                className="btn-admin"
                onClick={() => setShowUserManagement(true)}
                title={userProfile?.role === 'system' ? 'User Management' : 'Invite Users'}
              >
                {userProfile?.role === 'system' ? <Shield size={16} /> : <UserPlus size={16} />}
              </button>
            )}
            <WorkspacePresenceAvatars
              user={user}
              activeWorkspace={activeWorkspace}
              userProfile={userProfile}
            />
          </div>
          <div className="user-menu">
            <button className="user-menu-trigger" onClick={() => setShowUserDropdown(prev => !prev)}>
              <span className="user-email">{user.email}</span>
              <ChevronDown size={12} />
            </button>
            {showUserDropdown && (
              <>
                <div className="dropdown-backdrop" onClick={() => setShowUserDropdown(false)} />
                <div className="user-dropdown">
                  <div className="user-dropdown-header">
                    <span className="user-dropdown-email">{user.email}</span>
                    {userProfile?.role && <span className="user-dropdown-role">{userProfile.role}</span>}
                  </div>
                  {!('__TAURI_INTERNALS__' in window) && (
                    <button className="user-dropdown-item" onClick={async () => {
                      setShowUserDropdown(false);
                      const tabIds = openTabs.filter(t => t.type === 'request').map(t => t.entityId || t.request?.id).filter(Boolean);
                      const expandedC = JSON.parse(localStorage.getItem('expandedCollections') || '[]');
                      const expandedR = JSON.parse(localStorage.getItem('expandedRequests') || '[]');
                      const link = await data.getDesktopDeepLink({
                        tabIds,
                        activeTabId: activeTab?.entityId || activeTab?.request?.id,
                        expandedCollections: expandedC,
                        expandedRequests: expandedR,
                      });
                      if (link) {
                        const a = document.createElement('a');
                        a.href = link;
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      }
                    }}>
                      <Monitor size={14} />
                      Open in Desktop App
                    </button>
                  )}
                  <button className="user-dropdown-item" onClick={() => { setShowUserDropdown(false); setShowSettings(true); }}>
                    <Settings size={14} />
                    Settings
                  </button>
                  <button className="user-dropdown-item" onClick={() => { setShowUserDropdown(false); setShowAbout(true); }}>
                    <Info size={14} />
                    About
                  </button>
                  <div className="user-dropdown-divider" />
                  <button className="user-dropdown-item danger" onClick={() => { setShowUserDropdown(false); handleLogout(); }}>
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <WindowControls />
      </header>

      <div className="app-body">
        <Sidebar
          collections={collections}
          selectedRequest={selectedRequest}
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
        />
        <div
          className="sidebar-resize-handle"
          onMouseDown={startResizing}
        />
        <main className="main-content" ref={mainContentRef}>
          <div className="open-tabs-bar" onWheel={handleTabsWheel}>
            {openTabs.length === 0 ? (
              <div className="open-tabs-empty">No open requests</div>
            ) : (
              openTabs.map(tab => {
                const isExample = tab.type === 'example';
                const isCollection = tab.type === 'collection';
                const name = isCollection ? tab.collection?.name : (isExample ? tab.example?.name : tab.request?.name);
                const method = isExample ? tab.example?.request_data?.method : tab.request?.method;
                const isConflicted = !!conflictedTabs[tab.id];
                const isDeleted = deletedTabs.has(tab.id);

                // Build tooltip showing name with status
                let tooltip = `${isCollection ? '[Collection] ' : isExample ? '[Example] ' : ''}${name || 'Untitled'}`;
                if (isDeleted) tooltip += ' [deleted]';
                else if (isConflicted) tooltip += ' [conflicted]';

                return (
                <div
                  key={tab.id}
                  className={`open-tab ${tab.id === activeTabId ? 'active' : ''} ${tab.isTemporary ? 'temporary' : ''} ${isExample ? 'example-tab' : ''} ${isCollection ? 'collection-tab' : ''} ${isConflicted ? 'conflicted' : ''} ${isDeleted ? 'deleted' : ''} ${draggingTabId === tab.id ? 'dragging' : ''} ${dragOverTabId === tab.id ? 'drag-over' : ''} ${previewTabId === tab.id ? 'preview' : ''}`}
                  onClick={() => setActiveTabId(tab.id)}
                  draggable
                  onDragStart={(e) => handleTabDragStart(e, tab.id)}
                  onDragEnd={handleTabDragEnd}
                  onDragOver={(e) => handleTabDragOver(e, tab.id)}
                  onDrop={(e) => handleTabDrop(e, tab.id)}
                  title={tooltip}
                >
                  {isCollection ? (
                    <span className="tab-collection-badge">{tab.collection?.parent_id ? 'FD' : 'CL'}</span>
                  ) : isExample ? (
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
                    onClick={(e) => {
                      e.stopPropagation();
                      if (userConfig.skipCloseConfirm) {
                        closeTab(tab.id, e, { force: true });
                      } else if (tab.isTemporary) {
                        const r = tab.request || {};
                        const isEmpty = !r.url && !r.body && (!r.headers || r.headers.length === 0) && (!r.params || r.params.length === 0) && (!r.form_data || r.form_data.length === 0) && (!r.auth_token);
                        if (isEmpty) {
                          closeTab(tab.id, e);
                        } else {
                          setTempCloseTabId(tab.id);
                        }
                      } else if (tab.dirty) {
                        setDirtyCloseTabId(tab.id);
                      } else {
                        closeTab(tab.id, e);
                      }
                    }}
                    title="Close"
                  >
                    ×
                  </span>
                </div>
              );})
            )}
            {canEdit && (
              <button
                className="tab-add-btn"
                onClick={() => {
                  const tempId = `temp-${Date.now()}`;
                  const tempRequest = {
                    id: tempId,
                    name: 'New Request',
                    method: 'GET',
                    url: '',
                    headers: [],
                    body: '',
                    body_type: 'none',
                    form_data: [],
                    params: [],
                    auth_type: 'none',
                    auth_token: '',
                    pre_script: '',
                    post_script: '',
                    isTemporary: true,
                  };
                  setOpenTabs(prev => [...prev, {
                    id: tempId,
                    type: 'request',
                    request: tempRequest,
                    dirty: false,
                    response: null,
                    isTemporary: true,
                    activeDetailTab: 'params',
                  }]);
                  setActiveTabId(tempId);
                }}
                title="New Request"
                disabled={!activeWorkspace}
              >
                <Plus size={14} />
              </button>
            )}
          </div>

          {activeTab?.type === 'collection' ? (
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
                  toast.success('Collection saved');
                } catch (err) {
                  toast.error(err.message || 'Failed to save collection');
                }
              }}
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
                onEnvironmentUpdate={() => activeWorkspace?.id && loadEnvironments(activeWorkspace.id)}
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

      {showEnvEditor && (
        <EnvironmentEditor
          onClose={() => {
            setShowEnvEditor(false);
            if (activeWorkspace?.id) {
              loadEnvironments(activeWorkspace.id);
            }
          }}
          workspaceId={activeWorkspace?.id}
          workspaceName={activeWorkspace?.name}
          canEdit={canEdit}
        />
      )}

      {showWorkspaceSettings && activeWorkspace && (
        <WorkspaceSettings
          workspace={activeWorkspace}
          onClose={() => setShowWorkspaceSettings(false)}
          onUpdateWorkspace={handleUpdateWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          isAdmin={['system', 'admin'].includes(userProfile?.role)}
        />
      )}

      {showUserManagement && userProfile?.role === 'developer' ? (
        <InviteUserModal
          workspaceName={activeWorkspace?.name || 'Workspace'}
          userRole={userProfile?.role}
          onInvite={async (email, role) => {
            await handleInviteUser(email, role, [activeWorkspace?.id]);
          }}
          onClose={() => setShowUserManagement(false)}
        />
      ) : showUserManagement && (
        <UserManagement
          users={allUsers}
          allWorkspaces={allWorkspaces}
          activeWorkspace={activeWorkspace}
          currentUserId={user?.id}
          userRole={userProfile?.role}
          onClose={() => setShowUserManagement(false)}
          onInviteUser={handleInviteUser}
          onUpdateUser={handleUpdateUser}
          onUpdateUserWorkspaces={handleUpdateUserWorkspaces}
          onDeleteUser={handleDeleteUser}
          loading={usersLoading}
          isSystem={userProfile?.role === 'system'}
        />
      )}

      {showCloseModal && (
        <CloseToTrayModal
          onHideToTray={async (remember) => {
            setShowCloseModal(false);
            if (remember) {
              syncCloseBehaviorToRust('tray');
              data.updateUserConfig({ closeBehavior: 'tray' }).then(setUserConfig).catch(() => {});
            }
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('hide_window');
          }}
          onClose={async (remember) => {
            setShowCloseModal(false);
            if (remember) {
              syncCloseBehaviorToRust('close');
              data.updateUserConfig({ closeBehavior: 'close' }).then(setUserConfig).catch(() => {});
            }
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('close_app');
          }}
          onCancel={() => setShowCloseModal(false)}
        />
      )}

      {showAbout && (
        <AboutModal
          onClose={() => setShowAbout(false)}
          updateAvailable={updateAvailable}
          tauriUpdate={tauriUpdate}
          downloading={downloading}
          downloadProgress={downloadProgress}
          installUpdate={installUpdate}
        />
      )}

      {showSettings && (
        <SettingsModal
          config={userConfig}
          onClose={() => setShowSettings(false)}
          onSave={async (patch) => {
            const updated = await data.updateUserConfig(patch);
            setUserConfig(updated);
            if (patch.theme) {
              handleThemeChange(patch.theme);
            }
            if (patch.closeBehavior) {
              syncCloseBehaviorToRust(patch.closeBehavior);
            }
            toast.success('Settings saved');
          }}
        />
      )}

      {showImportCurl && (
        <ImportCurlModal
          onImport={handleImportCurl}
          onClose={() => setShowImportCurl(false)}
        />
      )}

      {draftSavePending && (
        <FolderPickerModal
          title="Save Request to..."
          collections={collections}
          onConfirm={async (folderId) => {
            const { tabId, requestData } = draftSavePending;
            try {
              const requestPayload = {
                collection_id: folderId,
                name: requestData.name || 'New Request',
                method: requestData.method || 'GET',
                url: requestData.url || '',
                headers: requestData.headers || [],
                body: requestData.body || '',
                body_type: requestData.body_type || 'none',
                form_data: requestData.form_data || [],
                params: requestData.params || [],
                auth_type: requestData.auth_type || 'none',
                auth_token: requestData.auth_token || '',
                pre_script: requestData.pre_script || '',
                post_script: requestData.post_script || '',
              };
              const created = await data.createRequest(requestPayload);
              setCollections((prev) => prev.map((c) => (
                c.id === folderId
                  ? { ...c, requests: [...(c.requests || []), { ...created, example_count: 0 }] }
                  : c
              )));
              // Remove the temp tab and open the real one
              setOpenTabs(prev => prev.filter(t => t.id !== tabId));
              openRequestInTab(created);
            } catch (err) {
              toast.error(err.message || 'Failed to create request');
            }
            setDraftSavePending(null);
          }}
          onCancel={() => setDraftSavePending(null)}
          confirmText="Save"
        />
      )}

      {tempCloseTabId && (
        <UnsavedChangesModal
          showRemember
          onCancel={() => setTempCloseTabId(null)}
          onSave={() => {
            const tab = openTabs.find(t => t.id === tempCloseTabId);
            if (tab) {
              setDraftSavePending({
                tabId: tempCloseTabId,
                requestData: tab.request || {},
              });
            }
            setTempCloseTabId(null);
          }}
          onDontSave={(remember) => {
            if (remember) {
              const next = { ...userConfig, skipCloseConfirm: true };
              setUserConfig(next);
              data.updateUserConfig({ skipCloseConfirm: true }).catch(() => {});
            }
            const tabId = tempCloseTabId;
            setOpenTabs(prev => {
              const newTabs = prev.filter(t => t.id !== tabId);
              if (activeTabId === tabId && newTabs.length > 0) {
                setActiveTabId(newTabs[newTabs.length - 1].id);
              } else if (newTabs.length === 0) {
                setActiveTabId(null);
              }
              return newTabs;
            });
            setTempCloseTabId(null);
          }}
        />
      )}

      {dirtyCloseTabId && (
        <UnsavedChangesModal
          showRemember
          onCancel={() => setDirtyCloseTabId(null)}
          onSave={() => {
            const tab = openTabs.find(t => t.id === dirtyCloseTabId);
            if (tab) {
              const saveData = tab.type === 'example'
                ? { name: tab.example?.name, request_data: tab.example?.request_data, response_data: tab.example?.response_data }
                : { method: tab.request?.method, url: tab.request?.url, headers: tab.request?.headers, body: tab.request?.body, body_type: tab.request?.body_type, auth_type: tab.request?.auth_type, auth_token: tab.request?.auth_token, params: tab.request?.params, pre_script: tab.request?.pre_script, post_script: tab.request?.post_script };
              const saveFn = tab.type === 'example' ? handleSaveExample : handleSaveRequest;
              saveFn(saveData);
            }
            closeTab(dirtyCloseTabId, null, { force: true });
            setDirtyCloseTabId(null);
          }}
          onDontSave={(remember) => {
            if (remember) {
              const next = { ...userConfig, skipCloseConfirm: true };
              setUserConfig(next);
              data.updateUserConfig({ skipCloseConfirm: true }).catch(() => {});
            }
            closeTab(dirtyCloseTabId, null, { force: true });
            setDirtyCloseTabId(null);
          }}
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
