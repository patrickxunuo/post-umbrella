import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { AuthCallback } from './components/AuthCallback';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { AppModals } from './components/AppModals';
import { CollectionEditor } from './components/CollectionEditor';
import { CollectionDocs } from './components/CollectionDocs';
import { WorkflowEditor } from './components/WorkflowEditor';
import { VariablePopoverProvider } from './components/VariablePopover';
import { AppHeader } from './components/AppHeader';
import { syncCloseBehaviorToRust } from './components/SettingsModal';
import { TabBar } from './components/TabBar';
import { useToast } from './components/Toast';
import { useConfirm } from './components/ConfirmModal';
import { usePrompt } from './components/PromptModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WorkbenchProvider, useWorkbench } from './contexts/WorkbenchContext';
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext';
import { CurlPanel } from './components/CurlPanel';
import { ConnectionStatus } from './components/ConnectionStatus';
import { BottomBar } from './components/BottomBar';
import { ConsolePanel } from './components/ConsolePanel';
import useConsoleStore from './stores/consoleStore';

const TerminalPanel = lazy(() => import('./components/TerminalPanel').then(m => ({ default: m.TerminalPanel })));
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { useLayoutState } from './hooks/useLayoutState';
import { useVersionCheck } from './hooks/useVersionCheck';
import { useClipboardLinks } from './hooks/useClipboardLinks';
import { useCollectionVariables } from './hooks/useCollectionVariables';
import { useTauriClose } from './hooks/useTauriClose';
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
import './styles/error-boundary.css';
import './styles/bottom-bar.css';

import useModalStore from './stores/modalStore';

function AppContent() {
  const showEnvEditor = useModalStore((s) => s.showEnvEditor);
  const setShowEnvEditor = useModalStore((s) => s.setShowEnvEditor);
  const showImportCurl = useModalStore((s) => s.showImportCurl);
  const setShowImportCurl = useModalStore((s) => s.setShowImportCurl);
  const draftSavePending = useModalStore((s) => s.draftSavePending);
  const setDraftSavePending = useModalStore((s) => s.setDraftSavePending);
  const tempCloseTabId = useModalStore((s) => s.tempCloseTabId);
  const setTempCloseTabId = useModalStore((s) => s.setTempCloseTabId);
  const dirtyCloseTabId = useModalStore((s) => s.dirtyCloseTabId);
  const setDirtyCloseTabId = useModalStore((s) => s.setDirtyCloseTabId);
  const showSettings = useModalStore((s) => s.showSettings);
  const setShowSettings = useModalStore((s) => s.setShowSettings);
  const showAbout = useModalStore((s) => s.showAbout);
  const setShowAbout = useModalStore((s) => s.setShowAbout);
  const showCloseModal = useModalStore((s) => s.showCloseModal);
  const setShowCloseModal = useModalStore((s) => s.setShowCloseModal);
  const [userConfig, setUserConfig] = useState({});
  const toast = useToast();
  const { updateAvailable, tauriUpdate, downloading, downloadProgress, installUpdate, checkForUpdate, checking, isTauri } = useVersionCheck();

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

  useTauriClose(userConfig);

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
    deletedTabs,
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
    environments,
    activeEnvironment,
    setActiveEnvironment,
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
    openCollectionInTab,
    openRequestInTab,
    saveFunctionsRef,
    workflows,
    loadWorkflows,
    openWorkflowInTab,
    openDocsInTab,
    updateTabWorkflow,
    handleSaveWorkflow,
  } = useWorkbench();

  useClipboardLinks();

  const activePanel = useConsoleStore((s) => s.activePanel);
  const panelHeight = useConsoleStore((s) => s.panelHeight);
  const setPanelHeight = useConsoleStore((s) => s.setPanelHeight);
  const [terminalMounted, setTerminalMounted] = useState(false);

  // Once terminal is opened, keep it mounted to preserve state
  useEffect(() => {
    if (activePanel === 'terminal') setTerminalMounted(true);
  }, [activePanel]);

  const startResizingBottom = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeight;
    const onMouseMove = (e) => {
      const delta = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(startHeight + delta, window.innerHeight * 0.6));
      setPanelHeight(newHeight);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelHeight, setPanelHeight]);

  const canEdit = ['system', 'admin', 'developer'].includes(userProfile?.role);

  const { collectionVariables, rootCollectionId, onEnvironmentUpdate } = useCollectionVariables();

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

  const { connected, reconnecting } = useRealtimeSync();

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
      onEnvironmentUpdate={onEnvironmentUpdate}
    >
    <div className="app">
      <ConnectionStatus connected={connected} reconnecting={reconnecting} />
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
              onEnvironmentUpdate={onEnvironmentUpdate}
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
                onEnvironmentUpdate={onEnvironmentUpdate}
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
          {activePanel && (
            <div className="bottom-panel-area" style={{ height: panelHeight }}>
              <div className="bottom-panel-resize-handle" onMouseDown={startResizingBottom} />
              <div className="bottom-panel-content" style={{ display: activePanel === 'console' ? 'flex' : 'none' }}>
                <ConsolePanel />
              </div>
              {terminalMounted && (
                <div className="bottom-panel-content" style={{ display: activePanel === 'terminal' ? 'flex' : 'none' }}>
                  <Suspense fallback={<div style={{ padding: 16, color: 'var(--text-tertiary)' }}>Loading terminal...</div>}>
                    <TerminalPanel />
                  </Suspense>
                </div>
              )}
            </div>
          )}
        </main>

        {showCurlPanel && (
          <CurlPanel
            width={curlPanelWidth}
            theme={theme}
            onResize={startResizingCurl}
            onClose={toggleCurlPanel}
          />
        )}

      </div>
      <BottomBar />

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
        checkForUpdate={checkForUpdate} checking={checking}
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
