import { FileText, MoreHorizontal, Edit2, Copy, Trash2, Link } from 'lucide-react';

function getStatusClass(status) {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400 && status < 500) return 'client-error';
  if (status >= 500) return 'server-error';
  return 'error';
}

export function ExampleItem({
  example, request, isSelected, canEdit,
  editingId, editingName, setEditingName, onRename, finishEditing,
  isDragging, isDragOver,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  menuOpen, menuRef, onToggleMenu, onMenuAction,
  pendingExampleIds,
  onClick,
}) {
  return (
    <div
      className={`example-item-sidebar ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
      data-example-id={example.id}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu(example.id, e); }}
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <FileText size={12} className="example-icon" />
      {editingId === `example-${example.id}` ? (
        <input
          className="rename-input example-rename"
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          onBlur={() => onRename(example.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(example.id);
            if (e.key === 'Escape') finishEditing();
          }}
          onClick={(e) => e.stopPropagation()}
          autoFocus
        />
      ) : (
        <span className="example-name">{example.name}</span>
      )}
      <span className={`example-status ${getStatusClass(example.response_data?.status)}`}>
        {example.response_data?.status || '---'}
      </span>
      <div className="example-actions">
        {pendingExampleIds?.has(example.id) ? (
          <span className="sidebar-inline-spinner" title="Updating example">
            <span className="loading-spinner small" />
          </span>
        ) : (
          <button onClick={(e) => onToggleMenu(example.id, e)} className="btn-icon small btn-menu" title="More actions">
            <MoreHorizontal size={12} />
          </button>
        )}
        {menuOpen === example.id && (
          <div className="request-menu example-menu" ref={menuRef}>
            {canEdit && (
              <>
                <button className="request-menu-item" onClick={(e) => onMenuAction('rename', example, request, e)}>
                  <Edit2 size={14} /> Rename
                </button>
                <button className="request-menu-item" onClick={(e) => onMenuAction('duplicate', example, request, e)}>
                  <Copy size={14} /> Duplicate
                </button>
              </>
            )}
            <button className="request-menu-item" onClick={(e) => onMenuAction('copy-link', example, request, e)}>
              <Link size={14} /> Copy Link
            </button>
            {canEdit && (
              <>
                <div className="request-menu-divider" />
                <button className="request-menu-item danger" onClick={(e) => onMenuAction('delete', example, request, e)}>
                  <Trash2 size={14} /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
