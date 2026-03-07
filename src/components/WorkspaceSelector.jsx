import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Settings, Plus, Briefcase, Check } from 'lucide-react';

export function WorkspaceSelector({
  workspaces,
  activeWorkspace,
  onWorkspaceChange,
  onCreateWorkspace,
  onOpenSettings,
  isAdmin,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

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
      >
        <Briefcase size={14} className="workspace-icon" />
        <span className="workspace-selector-label">
          {activeWorkspace ? activeWorkspace.name : 'No Workspace'}
        </span>
        <ChevronDown size={14} className={`workspace-selector-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="workspace-selector-dropdown">
          <div className="workspace-selector-options">
            {workspaces.map(workspace => (
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
          <div className="workspace-selector-footer">
            {isAdmin && (
              <button className="workspace-selector-action" onClick={handleCreateClick}>
                <Plus size={14} />
                New Workspace
              </button>
            )}
            {isAdmin && activeWorkspace && (
              <button className="workspace-selector-action" onClick={handleSettingsClick}>
                <Settings size={14} />
                Workspace Settings
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
