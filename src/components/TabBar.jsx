import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Terminal, Plus, Folder, FolderOpen, Play, FileText } from 'lucide-react';
import { METHOD_COLORS } from '../constants/methodColors';

export function TabBar({
  openTabs,
  activeTabId,
  setActiveTabId,
  setOpenTabs,
  previewTabId,
  conflictedTabs,
  deletedTabs,
  closeTab,
  closeManyTabs,
  canEdit,
  activeWorkspace,
  userConfig,
  setTempCloseTabId,
  setDirtyCloseTabId,
  onWheel,
}) {
  const [draggingTabId, setDraggingTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);
  const [menuState, setMenuState] = useState(null);
  const menuRef = useRef(null);

  const closeMenu = useCallback(() => setMenuState(null), []);

  const handleTabDragStart = useCallback((e, tabId) => {
    setDraggingTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleTabDragEnd = useCallback(() => {
    setDraggingTabId(null);
    setDragOverTabId(null);
  }, []);

  const handleTabDragOver = useCallback((e, tabId) => {
    e.preventDefault();
    if (draggingTabId && draggingTabId !== tabId) {
      setDragOverTabId(tabId);
    }
  }, [draggingTabId]);

  const handleTabDrop = useCallback((e, targetTabId) => {
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
  }, [draggingTabId, setOpenTabs]);

  // Dismiss context menu on outside click or Escape
  useEffect(() => {
    if (!menuState) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        closeMenu();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuState, closeMenu]);

  // Clamp menu to viewport so it never clips past the edges
  useLayoutEffect(() => {
    if (!menuState || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let { x, y } = menuState;
    let needsUpdate = false;
    if (rect.right > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - margin - rect.width);
      needsUpdate = true;
    }
    if (rect.bottom > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - margin - rect.height);
      needsUpdate = true;
    }
    if (needsUpdate && (x !== menuState.x || y !== menuState.y)) {
      setMenuState((prev) => (prev ? { ...prev, x, y } : prev));
    }
  }, [menuState]);

  const closeSingleTab = useCallback((tabId, e) => {
    const tab = openTabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (userConfig?.skipCloseConfirm) {
      closeTab(tabId, e, { force: true });
    } else if (tab.isTemporary) {
      const r = tab.request || {};
      const isEmpty = !r.url && !r.body && (!r.headers || r.headers.length === 0) && (!r.params || r.params.length === 0) && (!r.form_data || r.form_data.length === 0) && (!r.auth_token);
      if (isEmpty) {
        closeTab(tabId, e);
      } else {
        setTempCloseTabId(tabId);
      }
    } else if (tab.dirty) {
      setDirtyCloseTabId(tabId);
    } else {
      closeTab(tabId, e);
    }
  }, [openTabs, userConfig, closeTab, setTempCloseTabId, setDirtyCloseTabId]);

  const bulkCloseOpts = useCallback((extra = {}) => (
    userConfig?.skipCloseConfirm ? { ...extra, force: true } : extra
  ), [userConfig]);

  return (
    <div className="open-tabs-bar" onWheel={onWheel}>
      {openTabs.length === 0 ? (
        <div className="open-tabs-empty">No open requests</div>
      ) : (
        openTabs.map(tab => {
          const isExample = tab.type === 'example';
          const isCollection = tab.type === 'collection';
          const isWorkflow = tab.type === 'workflow';
          const isDocs = tab.type === 'docs';
          const name = isDocs ? tab.docs?.collectionName : isWorkflow ? tab.workflow?.name : isCollection ? tab.collection?.name : (isExample ? tab.example?.name : tab.request?.name);
          const method = isExample ? tab.example?.request_data?.method : tab.request?.method;
          const isConflicted = !!conflictedTabs[tab.id];
          const isDeleted = deletedTabs.has(tab.id);

          let tooltip = `${isWorkflow ? '[Workflow] ' : isCollection ? '[Collection] ' : isExample ? '[Example] ' : ''}${name || 'Untitled'}`;
          if (isDeleted) tooltip += ' [deleted]';
          else if (isConflicted) tooltip += ' [conflicted]';

          return (
            <div
              key={tab.id}
              className={`open-tab ${tab.id === activeTabId ? 'active' : ''} ${tab.isTemporary ? 'temporary' : ''} ${isExample ? 'example-tab' : ''} ${isCollection ? 'collection-tab' : ''} ${isWorkflow ? 'workflow-tab' : ''} ${isDocs ? 'docs-tab' : ''} ${isConflicted ? 'conflicted' : ''} ${isDeleted ? 'deleted' : ''} ${draggingTabId === tab.id ? 'dragging' : ''} ${dragOverTabId === tab.id ? 'drag-over' : ''} ${previewTabId === tab.id ? 'preview' : ''}`}
              onClick={() => setActiveTabId(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuState({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              draggable
              onDragStart={(e) => handleTabDragStart(e, tab.id)}
              onDragEnd={handleTabDragEnd}
              onDragOver={(e) => handleTabDragOver(e, tab.id)}
              onDrop={(e) => handleTabDrop(e, tab.id)}
              title={tooltip}
            >
              {isDocs ? (
                <span className="tab-docs-badge"><FileText size={11} /></span>
              ) : isWorkflow ? (
                <span className="tab-workflow-badge"><Play size={11} /></span>
              ) : isCollection ? (
                <span className="tab-collection-badge">{tab.collection?.parent_id ? <Folder size={12} /> : <FolderOpen size={12} />}</span>
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
                  closeSingleTab(tab.id, e);
                }}
                title="Close"
              >
                ×
              </span>
            </div>
          );
        })
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
            };
            setOpenTabs(prev => [...prev, {
              id: tempId,
              type: 'request',
              request: tempRequest,
              dirty: false,
              isTemporary: true,
              response: null,
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
      {menuState && (() => {
        const clickedId = menuState.tabId;
        const clickedIndex = openTabs.findIndex((t) => t.id === clickedId);
        if (clickedIndex < 0) return null;
        const others = openTabs.filter((t) => t.id !== clickedId);
        const leftTabs = openTabs.slice(0, clickedIndex);
        const rightTabs = openTabs.slice(clickedIndex + 1);
        const unmodifiedOthers = others.filter((t) => !t.dirty);

        const showOthers = others.length > 0;
        const showUnmodified = unmodifiedOthers.length > 0;
        const showLeft = leftTabs.length > 0;
        const showRight = rightTabs.length > 0;
        const showAnyBulk = showOthers || showUnmodified || showLeft || showRight;

        return (
          <div
            ref={menuRef}
            className="request-menu tab-context-menu"
            style={{ position: 'fixed', top: menuState.y, left: menuState.x, right: 'auto' }}
            data-testid="tab-context-menu"
            role="menu"
          >
            <button
              className="request-menu-item"
              data-testid="tab-menu-close"
              onClick={(e) => {
                e.stopPropagation();
                closeMenu();
                closeSingleTab(clickedId, e);
              }}
            >
              Close
            </button>
            {showAnyBulk && <div className="request-menu-divider" />}
            {showOthers && (
              <button
                className="request-menu-item"
                data-testid="tab-menu-close-others"
                onClick={(e) => {
                  e.stopPropagation();
                  closeMenu();
                  closeManyTabs(others.map((t) => t.id), bulkCloseOpts({ confirmTitle: 'Close Other Tabs' }));
                }}
              >
                Close Other Tabs
              </button>
            )}
            {showUnmodified && (
              <button
                className="request-menu-item"
                data-testid="tab-menu-close-unmodified"
                onClick={(e) => {
                  e.stopPropagation();
                  closeMenu();
                  closeManyTabs(unmodifiedOthers.map((t) => t.id), { force: true });
                }}
              >
                Close Unmodified Tabs
              </button>
            )}
            {showLeft && (
              <button
                className="request-menu-item"
                data-testid="tab-menu-close-left"
                onClick={(e) => {
                  e.stopPropagation();
                  closeMenu();
                  closeManyTabs(leftTabs.map((t) => t.id), bulkCloseOpts());
                }}
              >
                Close Tabs to the Left
              </button>
            )}
            {showRight && (
              <button
                className="request-menu-item"
                data-testid="tab-menu-close-right"
                onClick={(e) => {
                  e.stopPropagation();
                  closeMenu();
                  closeManyTabs(rightTabs.map((t) => t.id), bulkCloseOpts());
                }}
              >
                Close Tabs to the Right
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
