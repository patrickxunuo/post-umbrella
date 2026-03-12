import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Settings, Plus, Briefcase, Check } from 'lucide-react';

// Default workspace ID to hide from selector
const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

export function WorkspaceSelector({
  workspaces,
  activeWorkspace,
  onWorkspaceChange,
  onCreateWorkspace,
  onOpenSettings,
  canCreateWorkspace,
  canOpenSettings,
  loading = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Filter out the default workspace
  const visibleWorkspaces = workspaces.filter(ws => ws.id !== DEFAULT_WORKSPACE_ID);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = async (workspace) => {
    setIsOpen(false);
    if (workspace.id !== activeWorkspace?.id) {
      onWorkspaceChange(workspace);
    }
  };

  const handleSettingsClick = (e) => {
    e.stopPropagation();
    setIsOpen(false);
    onOpenSettings();
  };

  const handleCreateClick = (e) => {
    e.stopPropagation();
    setIsOpen(false);
    onCreateWorkspace();
  };

  return (
    <div className="workspace-selector" ref={containerRef}>
      <button
        className="workspace-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
      >
        {loading ? (
          <div className="loading-spinner small" />
        ) : (
          <Briefcase size={14} className="workspace-icon" />
        )}
        <span className="workspace-selector-label">
          {loading ? 'Loading...' : activeWorkspace ? activeWorkspace.name : 'No Workspace'}
        </span>
        <ChevronDown size={14} className={`workspace-selector-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="workspace-selector-dropdown">
          <div className="workspace-selector-options">
            {visibleWorkspaces.map(workspace => (
              <div
                key={workspace.id}
                className={`workspace-selector-option ${activeWorkspace?.id === workspace.id ? 'selected' : ''}`}
                onClick={() => handleSelect(workspace)}
              >
                <span className="workspace-option-name">{workspace.name}</span>
                {activeWorkspace?.id === workspace.id && (
                  <Check size={14} className="workspace-check" />
                )}
              </div>
            ))}
          </div>
          {(canCreateWorkspace || canOpenSettings) && (
            <div className="workspace-selector-footer">
              {canCreateWorkspace && (
                <button className="workspace-selector-action" onClick={handleCreateClick}>
                  <Plus size={14} />
                  New Workspace
                </button>
              )}
              {canOpenSettings && activeWorkspace && (
                <button className="workspace-selector-action" onClick={handleSettingsClick}>
                  <Settings size={14} />
                  Workspace Settings
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
