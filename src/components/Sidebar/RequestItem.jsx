import { ChevronDown, ChevronRight, Trash2, MoreHorizontal, Edit2, Copy, Plus, Link } from 'lucide-react';
import { METHOD_COLORS } from '../../constants/methodColors';
import { ExampleItem } from './ExampleItem';

export function RequestItem({
  request, collection, isSelected, canEdit,
  // Rename
  editingId, editingName, setEditingName, onRename, finishEditing,
  // Expand/examples
  isExpanded, hasExamples, examples, loadingExamples, pendingExampleListRequestIds,
  onToggleExpand, selectedExample, onOpenExample,
  // Drag
  isDragging, isDragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  // Menu
  menuOpen, menuRef, onToggleMenu, onMenuAction,
  // Example menu
  exampleMenuOpen, exampleMenuRef, onToggleExampleMenu, onExampleMenuAction, onExampleRename,
  // Example drag
  draggedExample, dragOverExample, onExampleDragStart, onExampleDragEnd, onExampleDragOver, onExampleDragLeave, onExampleDrop,
  // Pending
  requestPending, pendingExampleIds,
  // Click
  onClick,
}) {
  return (
    <div className="request-wrapper">
      <div
        className={`request-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
        data-request-id={request.id}
        onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu(request.id, e); }}
        draggable={canEdit}
        onDragStart={canEdit ? onDragStart : undefined}
        onDragEnd={canEdit ? onDragEnd : undefined}
        onDragOver={canEdit ? onDragOver : undefined}
        onDragLeave={canEdit ? onDragLeave : undefined}
        onDrop={canEdit ? onDrop : undefined}
      >
        {hasExamples ? (
          <span className="request-expand" onClick={onToggleExpand}>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span className="request-expand-placeholder" />
        )}
        <span className="request-method" style={{ color: METHOD_COLORS[request.method] || '#999' }}>
          {request.method}
        </span>
        {editingId === request.id ? (
          <input
            className="rename-input"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={() => onRename('request', request.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename('request', request.id);
              if (e.key === 'Escape') finishEditing();
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="request-name">{request.name}</span>
        )}
        <div className="request-actions">
          {requestPending ? (
            <span className="sidebar-inline-spinner" title="Updating request">
              <span className="loading-spinner small" />
            </span>
          ) : (
            <button onClick={(e) => onToggleMenu(request.id, e)} className="btn-icon small btn-menu" title="More actions">
              <MoreHorizontal size={14} />
            </button>
          )}
          {menuOpen === request.id && (
            <div className="request-menu" ref={menuRef}>
              {canEdit && (
                <>
                  <button className="request-menu-item" onClick={(e) => onMenuAction('add-example', request, e)}>
                    <Plus size={14} /> Add Example
                  </button>
                  <button className="request-menu-item" onClick={(e) => onMenuAction('rename', request, e)}>
                    <Edit2 size={14} /> Rename
                  </button>
                  <button className="request-menu-item" onClick={(e) => onMenuAction('duplicate', request, e)}>
                    <Copy size={14} /> Duplicate
                  </button>
                </>
              )}
              <button className="request-menu-item" onClick={(e) => onMenuAction('copy-link', request, e)}>
                <Link size={14} /> Copy Link
              </button>
              {canEdit && (
                <>
                  <div className="request-menu-divider" />
                  <button className="request-menu-item danger" onClick={(e) => onMenuAction('delete', request, e)}>
                    <Trash2 size={14} /> Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Examples */}
      {isExpanded && loadingExamples && (
        <div className="examples-list-sidebar examples-loading">
          <div className="loading-spinner small" />
          <span className="loading-text">Loading...</span>
        </div>
      )}
      {isExpanded && pendingExampleListRequestIds?.has(request.id) && !loadingExamples && (
        <div className="examples-list-sidebar examples-loading">
          <div className="loading-spinner small" />
          <span className="loading-text">Updating...</span>
        </div>
      )}
      {isExpanded && !loadingExamples && examples.length > 0 && (
        <div className="examples-list-sidebar">
          {examples.map((example) => (
            <ExampleItem
              key={example.id}
              example={example}
              request={request}
              isSelected={selectedExample?.id === example.id}
              canEdit={canEdit}
              editingId={editingId}
              editingName={editingName}
              setEditingName={setEditingName}
              onRename={onExampleRename}
              finishEditing={finishEditing}
              isDragging={draggedExample?.id === example.id}
              isDragOver={dragOverExample === example.id}
              onDragStart={canEdit ? (e) => onExampleDragStart(e, example, request.id) : undefined}
              onDragEnd={canEdit ? onExampleDragEnd : undefined}
              onDragOver={canEdit ? (e) => onExampleDragOver(e, example, examples) : undefined}
              onDragLeave={canEdit ? onExampleDragLeave : undefined}
              onDrop={canEdit ? (e) => onExampleDrop(e, example, request.id, examples) : undefined}
              menuOpen={exampleMenuOpen}
              menuRef={exampleMenuRef}
              onToggleMenu={onToggleExampleMenu}
              onMenuAction={onExampleMenuAction}
              pendingExampleIds={pendingExampleIds}
              onClick={() => onOpenExample?.(example, request)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
