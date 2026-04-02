import { useState, useCallback } from 'react';
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
  canEdit,
  activeWorkspace,
  userConfig,
  setTempCloseTabId,
  setDirtyCloseTabId,
  onWheel,
}) {
  const [draggingTabId, setDraggingTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);

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
    </div>
  );
}
