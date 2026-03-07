import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Settings } from 'lucide-react';
import * as data from '../data/index.js';

export function EnvironmentSelector({
  environments,
  activeEnvironment,
  onEnvironmentChange,
  onOpenEditor,
  collectionId,
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

  const handleSelect = async (env) => {
    setIsOpen(false);
    if (!collectionId) return;
    if (env === null) {
      // Deactivate
      await data.deactivateEnvironments(collectionId);
      onEnvironmentChange();
    } else if (env.id !== activeEnvironment?.id) {
      await data.activateEnvironment(env.id);
      onEnvironmentChange();
    }
  };

  const handleEditClick = (e) => {
    e.stopPropagation();
    setIsOpen(false);
    onOpenEditor();
  };

  return (
    <div className="env-selector" ref={containerRef}>
      <button
        className={`env-selector-trigger ${activeEnvironment ? 'has-env' : ''} ${!collectionId ? 'disabled' : ''}`}
        onClick={() => collectionId && setIsOpen(!isOpen)}
        disabled={!collectionId}
        title={!collectionId ? 'Select a request to manage environments' : undefined}
      >
        <span className="env-selector-label">
          {!collectionId ? 'No Collection' : (activeEnvironment ? activeEnvironment.name : 'No Environment')}
        </span>
        <ChevronDown size={14} className={`env-selector-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="env-selector-dropdown">
          <div className="env-selector-options">
            <div
              className={`env-selector-option ${!activeEnvironment ? 'selected' : ''}`}
              onClick={() => handleSelect(null)}
            >
              <span className="env-option-name">No Environment</span>
            </div>
            {environments.map(env => (
              <div
                key={env.id}
                className={`env-selector-option ${activeEnvironment?.id === env.id ? 'selected' : ''}`}
                onClick={() => handleSelect(env)}
              >
                <span className="env-option-name">{env.name}</span>
              </div>
            ))}
          </div>
          <div className="env-selector-footer">
            <button className="env-selector-edit" onClick={handleEditClick}>
              <Settings size={14} />
              Manage Environments
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
