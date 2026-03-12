import { useState, useEffect, useCallback } from 'react';
import { Terminal, AlertTriangle, X, Shield, UserPlus } from 'lucide-react';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { RequestEditor } from './components/RequestEditor';
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

function AppContent() {
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [showImportCurl, setShowImportCurl] = useState(false);
  const [draggingTabId, setDraggingTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);
  const toast = useToast();
  const { updateAvailable } = useVersionCheck();

  const {
    theme,
    handleThemeChange,
    sidebarWidth,
    requestEditorHeight,
    startResizing,
    startResizingVertical,
    mainContentRef,
  } = useLayoutState();

  const {
    user,
    authChecked,
    handleLogin,
    handleLogout,
  } = useAuth();

  const {
    activeWorkspace,
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
    currentRootCollectionId,
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
  } = useWorkbench();

  const handleTabsWheel = useCallback((event) => {
    const tabBar = event.currentTarget;
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    if (delta === 0) return;
    event.preventDefault();
    tabBar.scrollLeft += delta;
  }, []);

  const handleShareRequest = useCallback(async (requestId) => {
    const shareUrl = `${window.location.origin}/?request_id=${requestId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Request link copied to clipboard.');
    } catch (error) {
      toast.error('Failed to copy request link.');
    }
  }, [toast]);

  const handleShareExample = useCallback(async (exampleId) => {
    const shareUrl = `${window.location.origin}/?example_id=${exampleId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Example link copied to clipboard.');
    } catch (error) {
      toast.error('Failed to copy example link.');
    }
  }, [toast]);

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
      {updateAvailable && (
        <div className="version-toast">
          <span>New version available</span>
          <button onClick={() => window.location.reload()}>Refresh</button>
        </div>
      )}
      <header className="app-header">
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
          <ThemeToggle theme={theme} onToggle={handleThemeChange} />
          <EnvironmentSelector
            environments={environments}
            activeEnvironment={activeEnvironment}
            onEnvironmentChange={() => activeWorkspace?.id && loadEnvironments(activeWorkspace.id)}
            onOpenEditor={() => setShowEnvEditor(true)}
            workspaceId={activeWorkspace?.id}
          />
          {['system', 'admin', 'developer'].includes(userProfile?.role) && (
            <ImportDropdown
              onImportCurl={() => setShowImportCurl(true)}
              onImportFile={handleImport}
              disabled={!activeWorkspace}
            />
          )}
          <div className="header-presence-group">
            {['system', 'admin', 'developer'].includes(userProfile?.role) && (
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
          onShareRequest={handleShareRequest}
          onShareExample={handleShareExample}
          pendingRequestIds={pendingRequestIds}
          pendingExampleIds={pendingExampleIds}
          pendingExampleListRequestIds={pendingExampleListRequestIds}
          pendingCollectionIds={pendingCollectionIds}
          canAddCollection={!!activeWorkspace}
          canEdit={['system', 'admin', 'developer'].includes(userProfile?.role)}
          loading={collectionsLoading}
          revealRequestId={revealRequestId}
          onRevealComplete={() => setRevealRequestId(null)}
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
            canEdit={['system', 'admin', 'developer'].includes(userProfile?.role)}
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
            if (activeWorkspace?.id) {
              loadEnvironments(activeWorkspace.id);
            }
          }}
          workspaceId={activeWorkspace?.id}
          workspaceName={activeWorkspace?.name}
          canEdit={['system', 'admin', 'developer'].includes(userProfile?.role)}
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
