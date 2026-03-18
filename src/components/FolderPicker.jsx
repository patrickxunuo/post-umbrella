import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Folder, X, Search } from 'lucide-react';

function FolderPickerItem({ collection, allCollections, disabledId, selectedId, onSelect, depth, searchQuery, parentMatched }) {
  const [expanded, setExpanded] = useState(true);
  const childCollections = allCollections.filter(c => c.parent_id === collection.id);
  const isDisabled = collection.id === disabledId;
  const isSelected = collection.id === selectedId;
  const thisMatches = !searchQuery || parentMatched || collection.name.toLowerCase().includes(searchQuery);

  if (searchQuery && !thisMatches && !hasMatchingDescendant(collection, allCollections, searchQuery)) {
    return null;
  }

  return (
    <div className="move-to-folder">
      <div
        className={`move-to-folder-item ${isDisabled ? 'current' : ''} ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={() => !isDisabled && onSelect(collection.id)}
      >
        {childCollections.length > 0 ? (
          <span className="move-to-expand" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span className="move-to-expand-placeholder" />
        )}
        <Folder size={16} className="move-to-folder-icon" />
        <span className="move-to-folder-name">{collection.name}</span>
        {isDisabled && <span className="move-to-current-badge">Current</span>}
      </div>
      {expanded && childCollections.length > 0 && (
        <div className="move-to-children">
          {childCollections.map((child) => (
            <FolderPickerItem
              key={child.id}
              collection={child}
              allCollections={allCollections}
              disabledId={disabledId}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
              searchQuery={searchQuery}
              parentMatched={thisMatches}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function hasMatchingDescendant(collection, allCollections, query) {
  const children = allCollections.filter(c => c.parent_id === collection.id);
  return children.some(child =>
    child.name.toLowerCase().includes(query) ||
    hasMatchingDescendant(child, allCollections, query)
  );
}

export function FolderPickerModal({ title, collections, disabledId, onConfirm, onCancel, confirmText = 'Confirm' }) {
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef(null);
  const rootCollections = useMemo(() => collections.filter(c => !c.parent_id), [collections]);
  const searchQuery = search.trim().toLowerCase();

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal move-to-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body move-to-body">
          <div className="move-to-search">
            <Search size={14} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search folders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="move-to-tree">
            {rootCollections.map((collection) => (
              <FolderPickerItem
                key={collection.id}
                collection={collection}
                allCollections={collections}
                disabledId={disabledId}
                selectedId={selectedId}
                onSelect={setSelectedId}
                depth={0}
                searchQuery={searchQuery}
                parentMatched={false}
              />
            ))}
            {searchQuery && rootCollections.every(c =>
              !c.name.toLowerCase().includes(searchQuery) &&
              !hasMatchingDescendant(c, collections, searchQuery)
            ) && (
              <div className="move-to-empty">No matching folders</div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => onConfirm(selectedId)}
            disabled={!selectedId}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
