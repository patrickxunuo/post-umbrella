import { AlertTriangle, X } from 'lucide-react';
import { EnvironmentEditor } from './EnvironmentEditor';
import { WorkspaceSettings } from './WorkspaceSettings';
import { UserManagement } from './UserManagement';
import { InviteUserModal } from './InviteUserModal';
import { ImportCurlModal } from './ImportCurlModal';
import { ImportModal } from './ImportModal';
import { FolderPickerModal } from './FolderPicker';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import { SettingsModal, syncCloseBehaviorToRust } from './SettingsModal';
import { AboutModal } from './AboutModal';
import { CloseToTrayModal } from './CloseToTrayModal';
import * as data from '../data/index.js';

export function AppModals({
  // Environment editor
  showEnvEditor, setShowEnvEditor, activeWorkspace, loadEnvironments, canEdit,
  // Workspace settings
  showWorkspaceSettings, setShowWorkspaceSettings, handleUpdateWorkspace, handleDeleteWorkspace, userProfile,
  // User management
  showUserManagement, setShowUserManagement, allUsers, allWorkspaces, user, handleInviteUser, handleUpdateUser, handleUpdateUserWorkspaces, handleDeleteUser, usersLoading,
  // Close to tray
  showCloseModal, setShowCloseModal, userConfig, setUserConfig,
  // About
  showAbout, setShowAbout, updateAvailable, tauriUpdate, downloading, downloadProgress, installUpdate, checkForUpdate, checking,
  // Settings
  showSettings, setShowSettings, handleThemeChange, toast,
  // Import cURL
  showImportCurl, setShowImportCurl, handleImportCurl,
  // Import Collection (multi-format)
  showImportModal, setShowImportModal, handleImport,
  // Draft save (temp request → folder picker)
  draftSavePending, setDraftSavePending, collections, setCollections, openTabs, setOpenTabs, activeTabId, setActiveTabId, openRequestInTab,
  // Unsaved changes (temp tab close)
  tempCloseTabId, setTempCloseTabId,
  // Dirty tab close
  dirtyCloseTabId, setDirtyCloseTabId, closeTab, handleSaveRequest, handleSaveExample,
  // Conflict
  showConflictModal, setShowConflictModal, pendingSaveTabId, deletedTabs, handleDiscardChanges, handleOverwriteConflict,
}) {
  return (
    <>
      {showEnvEditor && (
        <EnvironmentEditor
          onClose={() => {
            setShowEnvEditor(false);
            if (activeWorkspace?.id) loadEnvironments(activeWorkspace.id);
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
          checkForUpdate={checkForUpdate}
          checking={checking}
        />
      )}

      {showSettings && (
        <SettingsModal
          config={userConfig}
          onClose={() => setShowSettings(false)}
          onSave={async (patch) => {
            const updated = await data.updateUserConfig(patch);
            setUserConfig(updated);
            if (patch.theme) handleThemeChange(patch.theme);
            if (patch.closeBehavior) syncCloseBehaviorToRust(patch.closeBehavior);
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

      <ImportModal
        open={!!showImportModal}
        onClose={() => setShowImportModal(false)}
        onCommit={handleImport}
        userConfig={userConfig}
        setUserConfig={setUserConfig}
      />


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
              setDraftSavePending({ tabId: tempCloseTabId, requestData: tab.request || {} });
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
                <button className="btn-secondary" onClick={() => setShowConflictModal(false)}>Cancel</button>
                <button className="btn-secondary" onClick={handleDiscardChanges}>{isDeletedModal ? 'Close Tab' : 'Discard'}</button>
                <button className={isDeletedModal ? 'btn-primary' : 'btn-danger'} onClick={handleOverwriteConflict}>{isDeletedModal ? 'Create New' : 'Overwrite'}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
