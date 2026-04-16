import { useState } from 'react';
import { Shield, UserPlus, LogOut, ChevronDown, Monitor, Settings, Info } from 'lucide-react';
import { WindowControls } from './WindowControls';
import { WorkspaceSelector } from './WorkspaceSelector';
import { WorkspacePresenceAvatars } from './WorkspacePresenceAvatars';
import { EnvironmentSelector } from './EnvironmentSelector';
import { ImportDropdown } from './ImportDropdown';
import { ThemeToggle } from './ThemeToggle';
import * as data from '../data/index.js';

export function AppHeader({
  user,
  userProfile,
  userConfig,
  setUserConfig,
  theme,
  handleThemeChange,
  workspaces,
  activeWorkspace,
  workspacesLoading,
  handleWorkspaceChange,
  handleCreateWorkspace,
  handleOpenWorkspaceSettings,
  environments,
  activeEnvironment,
  loadEnvironments,
  canEdit,
  openTabs,
  activeTab,
  setShowEnvEditor,
  setShowImportCurl,
  setShowImportModal,
  setShowUserManagement,
  setShowSettings,
  setShowAbout,
  handleLogout,
}) {
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  return (
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
            onOpenImportModal={() => setShowImportModal(true)}
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
  );
}
