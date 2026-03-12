import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, Trash2, FileText, MoreHorizontal, Edit2, Copy, Search, Plus, FolderPlus, FolderInput, X, Folder, Crosshair, ChevronsDownUp, ChevronsUpDown, Download, Share2 } from 'lucide-react';
import * as data from '../data/index.js';
import { useConfirm } from './ConfirmModal';
import { DropdownMenu } from './DropdownMenu';

const METHOD_COLORS = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  PATCH: '#50e3c2',
  DELETE: '#f93e3e',
  HEAD: '#9012fe',
  OPTIONS: '#0d5aa7',
};

export function Sidebar({
  collections,
  selectedRequest,
  onSelectRequest,
  onCreateCollection,
  onCreateSubCollection,
  onCreateRequest,
  onDeleteCollection,
  onDeleteRequest,
  onRenameCollection,
  onRenameRequest,
  onDuplicateRequest,
  onMoveRequest,
  onExportCollection,
  width,
  onOpenExample,
  onCreateExample,
  onDeleteExample,
  onDuplicateExample,
  onRenameExample,
  onShareRequest,
  onShareExample,
  pendingRequestIds = new Set(),
  pendingExampleIds = new Set(),
  pendingExampleListRequestIds = new Set(),
  pendingCollectionIds = new Set(),
  canAddCollection = true,
  canEdit = true,
  loading = false,
  revealRequestId = null,
  onRevealComplete,
}) {
  const confirm = useConfirm();
  const [expandedCollections, setExpandedCollections] = useState(() => {
    const saved = localStorage.getItem('expandedCollections');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [expandedRequests, setExpandedRequests] = useState(() => {
    const saved = localStorage.getItem('expandedRequests');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [requestExamples, setRequestExamples] = useState({});
  const [loadingExamples, setLoadingExamples] = useState({}); // Track which requests are loading examples
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [menuOpen, setMenuOpen] = useState(null);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(null);
  const [draggedRequest, setDraggedRequest] = useState(null);
  const [dragOverRequest, setDragOverRequest] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [exampleMenuOpen, setExampleMenuOpen] = useState(null);
  const [moveModalRequest, setMoveModalRequest] = useState(null);
  const [selectedMoveFolder, setSelectedMoveFolder] = useState(null);
  const menuRef = useRef(null);
  const collectionMenuRef = useRef(null);
  const exampleMenuRef = useRef(null);
  const collectionsRef = useRef(collections);

  // Save expanded state to localStorage
  useEffect(() => {
    localStorage.setItem('expandedCollections', JSON.stringify([...expandedCollections]));
  }, [expandedCollections]);

  useEffect(() => {
    localStorage.setItem('expandedRequests', JSON.stringify([...expandedRequests]));
  }, [expandedRequests]);

  useEffect(() => {
    const requestIdsInCollections = new Set();
    collections.forEach((collection) => {
      (collection.requests || []).forEach((request) => {
        requestIdsInCollections.add(request.id);
      });
    });

    const missingExpandedRequestIds = [...expandedRequests].filter((requestId) => (
      requestIdsInCollections.has(requestId) &&
      !requestExamples[requestId] &&
      !loadingExamples[requestId]
    ));

    if (missingExpandedRequestIds.length === 0) {
      return;
    }

    missingExpandedRequestIds.forEach(async (requestId) => {
      setLoadingExamples((prev) => ({ ...prev, [requestId]: true }));
      try {
        const examples = await data.getExamples(requestId);
        setRequestExamples((prev) => ({
          ...prev,
          [requestId]: examples,
        }));
      } catch (err) {
        console.error('Failed to load examples for expanded request:', err);
      } finally {
        setLoadingExamples((prev) => ({ ...prev, [requestId]: false }));
      }
    });
  }, [collections, expandedRequests, loadingExamples, requestExamples]);

  // Refresh examples only for expanded requests whose row actually changed.
  useEffect(() => {
    const previousCollections = collectionsRef.current;

    if (previousCollections !== collections && previousCollections.length > 0) {
      const previousRequests = new Map();
      const nextRequests = new Map();

      previousCollections.forEach((collection) => {
        (collection.requests || []).forEach((request) => {
          previousRequests.set(request.id, request);
        });
      });

      collections.forEach((collection) => {
        (collection.requests || []).forEach((request) => {
          nextRequests.set(request.id, request);
        });
      });

      const changedExpandedRequestIds = [...expandedRequests].filter((requestId) => {
        const previousRequest = previousRequests.get(requestId);
        const nextRequest = nextRequests.get(requestId);

        if (!previousRequest || !nextRequest) {
          return Boolean(nextRequest);
        }

        return previousRequest !== nextRequest;
      });

      const deletedRequestIds = [...previousRequests.keys()].filter((requestId) => !nextRequests.has(requestId));
      if (deletedRequestIds.length > 0) {
        setRequestExamples((prev) => {
          const next = { ...prev };
          deletedRequestIds.forEach((requestId) => {
            delete next[requestId];
          });
          return next;
        });
      }

      changedExpandedRequestIds.forEach(async (requestId) => {
        try {
          const examples = await data.getExamples(requestId);
          setRequestExamples(prev => ({
            ...prev,
            [requestId]: examples
          }));
        } catch (err) {
          // Request might have been deleted, ignore
        }
      });
    }

    collectionsRef.current = collections;
  }, [collections, expandedRequests]);

  // Build tree structure from flat list
  const rootCollections = useMemo(() => {
    return collections.filter(c => !c.parent_id);
  }, [collections]);

  const getChildCollections = (parentId) => {
    return collections.filter(c => c.parent_id === parentId);
  };

  // Filter requests based on search query
  const filterRequests = (requests) => {
    if (!searchQuery.trim()) return requests;
    const query = searchQuery.toLowerCase();
    return requests?.filter(r =>
      r.name.toLowerCase().includes(query) ||
      r.url?.toLowerCase().includes(query)
    ) || [];
  };

  // Check if collection or its children have matching requests
  const hasMatchingRequests = (collection) => {
    if (!searchQuery.trim()) return true;
    const filteredReqs = filterRequests(collection.requests);
    if (filteredReqs.length > 0) return true;
    const children = getChildCollections(collection.id);
    return children.some(child => hasMatchingRequests(child));
  };

  const toggleCollection = (id) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleRequest = async (requestId, e) => {
    e.stopPropagation();

    const isExpanding = !expandedRequests.has(requestId);

    setExpandedRequests((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });

    // Fetch examples if expanding and not already loaded
    if (isExpanding && !requestExamples[requestId]) {
      setLoadingExamples(prev => ({ ...prev, [requestId]: true }));
      try {
        const examples = await data.getExamples(requestId);
        setRequestExamples(prev => ({
          ...prev,
          [requestId]: examples
        }));
      } catch (err) {
        console.error('Failed to load examples:', err);
      } finally {
        setLoadingExamples(prev => ({ ...prev, [requestId]: false }));
      }
    }
  };

  // Refresh examples for a request
  const refreshExamples = async (requestId) => {
    try {
      const examples = await data.getExamples(requestId);
      setRequestExamples(prev => ({
        ...prev,
        [requestId]: examples
      }));
    } catch (err) {
      console.error('Failed to refresh examples:', err);
    }
  };

  const startEditing = (id, name, e) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingName(name);
  };

  const handleRename = (type, id) => {
    if (editingName.trim()) {
      if (type === 'collection') {
        onRenameCollection(id, editingName);
      } else {
        onRenameRequest(id, editingName);
      }
    }
    setEditingId(null);
    setEditingName('');
  };

  const getStatusClass = (status) => {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client-error';
    if (status >= 500) return 'server-error';
    return 'error';
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(null);
      }
      if (collectionMenuRef.current && !collectionMenuRef.current.contains(e.target)) {
        setCollectionMenuOpen(null);
      }
      if (exampleMenuRef.current && !exampleMenuRef.current.contains(e.target)) {
        setExampleMenuOpen(null);
      }
    };

    if (menuOpen || collectionMenuOpen || exampleMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen, collectionMenuOpen, exampleMenuOpen]);

  const toggleMenu = (requestId, e) => {
    e.stopPropagation();
    setMenuOpen(menuOpen === requestId ? null : requestId);
  };

  const toggleCollectionMenu = (collectionId, e) => {
    e.stopPropagation();
    setCollectionMenuOpen(collectionMenuOpen === collectionId ? null : collectionId);
  };

  const toggleExampleMenu = (exampleId, e) => {
    e.stopPropagation();
    setExampleMenuOpen(exampleMenuOpen === exampleId ? null : exampleId);
  };

  const handleCollectionMenuAction = async (action, collection, e) => {
    e.stopPropagation();
    setCollectionMenuOpen(null);

    switch (action) {
      case 'add-request':
        onCreateRequest(collection.id);
        // Auto-expand the collection
        setExpandedCollections(prev => new Set([...prev, collection.id]));
        break;
      case 'add-folder':
        onCreateSubCollection?.(collection.id);
        // Auto-expand the collection
        setExpandedCollections(prev => new Set([...prev, collection.id]));
        break;
      case 'rename':
        setEditingId(collection.id);
        setEditingName(collection.name);
        break;
      case 'export':
        onExportCollection?.(collection);
        break;
      case 'delete':
        const confirmed = await confirm({
          title: 'Delete Folder',
          message: `Are you sure you want to delete "${collection.name}" and all its contents?`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          variant: 'danger',
        });
        if (confirmed) {
          onDeleteCollection(collection.id);
        }
        break;
    }
  };

  const handleMenuAction = async (action, request, e) => {
    e.stopPropagation();
    setMenuOpen(null);

    switch (action) {
      case 'rename':
        setEditingId(request.id);
        setEditingName(request.name);
        break;
      case 'duplicate':
        onDuplicateRequest?.(request);
        break;
      case 'add-example':
        {
          const created = await onCreateExample?.(request.id);
          if (created) {
            setRequestExamples(prev => ({
              ...prev,
              [request.id]: [created, ...(prev[request.id] || [])],
            }));
          }
        }
        setExpandedRequests((prev) => new Set([...prev, request.id]));
        break;
      case 'share':
        await onShareRequest?.(request.id);
        break;
      case 'delete':
        const confirmed = await confirm({
          title: 'Delete Request',
          message: `Are you sure you want to delete "${request.name}"?`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          variant: 'danger',
        });
        if (confirmed) {
          onDeleteRequest(request.id);
        }
        break;
    }
  };

  const handleExampleMenuAction = async (action, example, parentRequest, e) => {
    e.stopPropagation();
    setExampleMenuOpen(null);

    switch (action) {
      case 'rename':
        setEditingId(`example-${example.id}`);
        setEditingName(example.name);
        break;
      case 'duplicate':
        {
          const duplicated = await onDuplicateExample?.(example);
          if (duplicated) {
            setRequestExamples(prev => ({
              ...prev,
              [parentRequest.id]: [duplicated, ...(prev[parentRequest.id] || [])],
            }));
          }
        }
        break;
      case 'share':
        await onShareExample?.(example.id);
        break;
      case 'delete':
        const confirmed = await confirm({
          title: 'Delete Example',
          message: `Are you sure you want to delete "${example.name}"?`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          variant: 'danger',
        });
        if (confirmed) {
          await onDeleteExample?.(example.id, parentRequest.id);
          setRequestExamples(prev => ({
            ...prev,
            [parentRequest.id]: (prev[parentRequest.id] || []).filter((item) => item.id !== example.id),
          }));
        }
        break;
    }
  };

  const handleExampleRename = async (exampleId) => {
    if (editingName.trim()) {
      const updated = await onRenameExample?.(exampleId, editingName);
      if (updated) {
        setRequestExamples(prev => ({
          ...prev,
          [updated.request_id]: (prev[updated.request_id] || []).map((example) => (
            example.id === exampleId ? { ...example, name: updated.name } : example
          )),
        }));
      }
    }
    setEditingId(null);
    setEditingName('');
  };

  // Drag and drop handlers
  const handleDragStart = (e, request, collectionId) => {
    setDraggedRequest({ ...request, collectionId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', request.id);
  };

  const handleDragEnd = () => {
    setDraggedRequest(null);
    setDragOverRequest(null);
  };

  const handleDragOver = (e, request) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedRequest && draggedRequest.id !== request.id) {
      setDragOverRequest(request.id);
    }
  };

  const handleDragLeave = () => {
    setDragOverRequest(null);
  };

  const handleDrop = async (e, targetRequest, collectionId, requests) => {
    e.preventDefault();
    setDragOverRequest(null);

    if (!draggedRequest || draggedRequest.id === targetRequest.id) return;
    if (draggedRequest.collectionId !== collectionId) return;

    const requestIds = requests.map(r => r.id);
    const draggedIndex = requestIds.indexOf(draggedRequest.id);
    const targetIndex = requestIds.indexOf(targetRequest.id);

    requestIds.splice(draggedIndex, 1);
    requestIds.splice(targetIndex, 0, draggedRequest.id);

    try {
      await data.reorderRequests(collectionId, requestIds);
    } catch (err) {
      console.error('Failed to reorder requests:', err);
    }

    setDraggedRequest(null);
  };

  // Handle move to action
  const handleMoveToAction = (request, e) => {
    e.stopPropagation();
    setMenuOpen(null);
    setMoveModalRequest(request);
    setSelectedMoveFolder(null);
  };

  const handleSelectMoveFolder = (collectionId) => {
    setSelectedMoveFolder(collectionId);
  };

  const handleConfirmMove = async () => {
    if (!moveModalRequest || !selectedMoveFolder) return;
    try {
      await onMoveRequest?.(moveModalRequest.id, selectedMoveFolder);
      setMoveModalRequest(null);
      setSelectedMoveFolder(null);
    } catch (err) {
      console.error('Failed to move request:', err);
    }
  };

  const handleCancelMove = () => {
    setMoveModalRequest(null);
    setSelectedMoveFolder(null);
  };

  // Expand all folders
  const handleExpandAll = () => {
    const allCollectionIds = collections.map(c => c.id);
    setExpandedCollections(new Set(allCollectionIds));
  };

  // Collapse all folders
  const handleCollapseAll = () => {
    setExpandedCollections(new Set());
  };

  // Scroll to active request (reveal in sidebar)
  const handleScrollToActive = () => {
    if (!selectedRequest) return;

    // Find the collection containing this request and expand it + all parents
    const findAndExpandPath = (targetRequest) => {
      const collectionsToExpand = new Set();

      // Find collection containing this request
      const findCollection = (collectionId) => {
        const collection = collections.find(c => c.id === collectionId);
        if (!collection) return null;

        // Check if request is in this collection
        if (collection.requests?.some(r => r.id === targetRequest.id)) {
          collectionsToExpand.add(collection.id);
          // Also expand all parent collections
          let parent = collections.find(c => c.id === collection.parent_id);
          while (parent) {
            collectionsToExpand.add(parent.id);
            parent = collections.find(c => c.id === parent.parent_id);
          }
          return true;
        }

        return false;
      };

      // Search through all collections
      for (const collection of collections) {
        if (findCollection(collection.id)) break;
      }

      return collectionsToExpand;
    };

    const collectionsToExpand = findAndExpandPath(selectedRequest);
    setExpandedCollections(prev => new Set([...prev, ...collectionsToExpand]));

    // Scroll to the request element after a short delay to allow expansion
    setTimeout(() => {
      const requestElement = document.querySelector(`.request-item.selected`);
      if (requestElement) {
        requestElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Auto-reveal request when revealRequestId is set (e.g., from shared link)
  useEffect(() => {
    if (!revealRequestId || collections.length === 0) return;

    // Find the request in collections
    let targetRequest = null;
    for (const collection of collections) {
      const found = collection.requests?.find((r) => r.id === revealRequestId);
      if (found) {
        targetRequest = { ...found, collection_id: collection.id };
        break;
      }
    }

    if (!targetRequest) {
      onRevealComplete?.();
      return;
    }

    // Expand all parent collections
    const collectionsToExpand = new Set();
    let currentCollectionId = targetRequest.collection_id;
    while (currentCollectionId) {
      collectionsToExpand.add(currentCollectionId);
      const parentCollection = collections.find((c) => c.id === currentCollectionId);
      currentCollectionId = parentCollection?.parent_id;
    }

    setExpandedCollections((prev) => new Set([...prev, ...collectionsToExpand]));

    // Scroll to the request after expansion
    setTimeout(() => {
      const requestElement = document.querySelector(`[data-request-id="${revealRequestId}"]`);
      if (requestElement) {
        requestElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      onRevealComplete?.();
    }, 100);
  }, [revealRequestId, collections, onRevealComplete]);

  // Recursive collection renderer
  const renderCollection = (collection, depth = 0) => {
    // Skip collections with no matching requests when searching
    if (searchQuery.trim() && !hasMatchingRequests(collection)) {
      return null;
    }

    const childCollections = getChildCollections(collection.id);
    const filteredReqs = filterRequests(collection.requests);
    // Auto-expand when searching
    const isExpanded = searchQuery.trim() ? true : expandedCollections.has(collection.id);
    const hasChildren = childCollections.length > 0 || (collection.requests?.length > 0);

    return (
      <div key={collection.id} className="collection">
        <div
          className="collection-header"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => toggleCollection(collection.id)}
        >
          <span className="collection-arrow">
            {hasChildren ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
          </span>
          {collection.parent_id && <Folder size={12} className="folder-icon" />}
          {editingId === collection.id ? (
            <input
              className="rename-input"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => handleRename('collection', collection.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename('collection', collection.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className="collection-name">{collection.name}</span>
          )}
          <div className="collection-actions">
            {pendingCollectionIds.has(collection.id) ? (
              <span className="sidebar-inline-spinner" title="Updating folder">
                <span className="loading-spinner small" />
              </span>
            ) : (
              <button
                onClick={(e) => toggleCollectionMenu(collection.id, e)}
                className="btn-icon small btn-menu"
                title="More actions"
              >
                <MoreHorizontal size={14} />
              </button>
            )}
            {collectionMenuOpen === collection.id && (
              <div className="request-menu collection-menu" ref={collectionMenuRef}>
                {canEdit && (
                  <>
                    <button
                      className="request-menu-item"
                      onClick={(e) => handleCollectionMenuAction('add-request', collection, e)}
                    >
                      <Plus size={14} />
                      Add Request
                    </button>
                    <button
                      className="request-menu-item"
                      onClick={(e) => handleCollectionMenuAction('add-folder', collection, e)}
                    >
                      <FolderPlus size={14} />
                      Add Folder
                    </button>
                    <button
                      className="request-menu-item"
                      onClick={(e) => handleCollectionMenuAction('rename', collection, e)}
                    >
                      <Edit2 size={14} />
                      Rename
                    </button>
                  </>
                )}
                {!collection.parent_id && (
                  <button
                    className="request-menu-item"
                    onClick={(e) => handleCollectionMenuAction('export', collection, e)}
                  >
                    <Download size={14} />
                    Export
                  </button>
                )}
                {canEdit && (
                  <>
                    <div className="request-menu-divider" />
                    <button
                      className="request-menu-item danger"
                      onClick={(e) => handleCollectionMenuAction('delete', collection, e)}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="collection-children">
            {/* Render child collections first */}
            {childCollections.map(child => renderCollection(child, depth + 1))}

            {/* Render requests */}
            {filteredReqs?.length > 0 ? (
              <div className="collection-requests" style={{ paddingLeft: `${20 + depth * 16}px` }}>
                {filteredReqs.map((request) => {
                  const isSelected = selectedRequest?.id === request.id;
                  const isRequestExpanded = expandedRequests.has(request.id);
                  const examples = requestExamples[request.id] || [];
                  const hasExamples = request.example_count > 0 || examples.length > 0;
                  const requestPending = pendingRequestIds.has(request.id) || pendingExampleListRequestIds.has(request.id);

                  return (
                    <div key={request.id} className="request-wrapper">
                      <div
                        className={`request-item ${isSelected ? 'selected' : ''} ${draggedRequest?.id === request.id ? 'dragging' : ''} ${dragOverRequest === request.id ? 'drag-over' : ''}`}
                        data-request-id={request.id}
                        onClick={() => onSelectRequest(request)}
                        draggable={canEdit}
                        onDragStart={canEdit ? (e) => handleDragStart(e, request, collection.id) : undefined}
                        onDragEnd={canEdit ? handleDragEnd : undefined}
                        onDragOver={canEdit ? (e) => handleDragOver(e, request) : undefined}
                        onDragLeave={canEdit ? handleDragLeave : undefined}
                        onDrop={canEdit ? (e) => handleDrop(e, request, collection.id, collection.requests) : undefined}
                      >
                        {hasExamples ? (
                          <span
                            className="request-expand"
                            onClick={(e) => toggleRequest(request.id, e)}
                          >
                            {isRequestExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </span>
                        ) : (
                          <span className="request-expand-placeholder" />
                        )}
                        <span
                          className="request-method"
                          style={{ color: METHOD_COLORS[request.method] || '#999' }}
                        >
                          {request.method}
                        </span>
                        {editingId === request.id ? (
                          <input
                            className="rename-input"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => handleRename('request', request.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename('request', request.id);
                              if (e.key === 'Escape') setEditingId(null);
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
                            <button
                              onClick={(e) => toggleMenu(request.id, e)}
                              className="btn-icon small btn-menu"
                              title="More actions"
                            >
                              <MoreHorizontal size={14} />
                            </button>
                          )}
                          {menuOpen === request.id && (
                            <div className="request-menu" ref={menuRef}>
                              {canEdit && (
                                <>
                                  <button
                                    className="request-menu-item"
                                    onClick={(e) => handleMenuAction('add-example', request, e)}
                                  >
                                    <Plus size={14} />
                                    Add Example
                                  </button>
                                  <button
                                    className="request-menu-item"
                                    onClick={(e) => handleMenuAction('rename', request, e)}
                                  >
                                    <Edit2 size={14} />
                                    Rename
                                  </button>
                                  <button
                                    className="request-menu-item"
                                    onClick={(e) => handleMenuAction('duplicate', request, e)}
                                  >
                                    <Copy size={14} />
                                    Duplicate
                                  </button>
                                  <button
                                    className="request-menu-item"
                                    onClick={(e) => handleMoveToAction(request, e)}
                                  >
                                    <FolderInput size={14} />
                                    Move to...
                                  </button>
                                </>
                              )}
                              <button
                                className="request-menu-item"
                                onClick={(e) => handleMenuAction('share', request, e)}
                              >
                                <Share2 size={14} />
                                Share
                              </button>
                              {canEdit && (
                                <>
                                  <div className="request-menu-divider" />
                                  <button
                                    className="request-menu-item danger"
                                    onClick={(e) => handleMenuAction('delete', request, e)}
                                  >
                                    <Trash2 size={14} />
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Examples as children */}
                      {isRequestExpanded && loadingExamples[request.id] && (
                        <div className="examples-list-sidebar examples-loading">
                          <div className="loading-spinner small" />
                          <span className="loading-text">Loading...</span>
                        </div>
                      )}
                      {isRequestExpanded && pendingExampleListRequestIds.has(request.id) && !loadingExamples[request.id] && (
                        <div className="examples-list-sidebar examples-loading">
                          <div className="loading-spinner small" />
                          <span className="loading-text">Updating...</span>
                        </div>
                      )}
                      {isRequestExpanded && !loadingExamples[request.id] && examples.length > 0 && (
                        <div className="examples-list-sidebar">
                          {examples.map((example) => (
                            <div
                              key={example.id}
                              className="example-item-sidebar"
                              onClick={() => onOpenExample?.(example, request)}
                            >
                              <FileText size={12} className="example-icon" />
                              {editingId === `example-${example.id}` ? (
                                <input
                                  className="rename-input example-rename"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onBlur={() => handleExampleRename(example.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleExampleRename(example.id);
                                    if (e.key === 'Escape') setEditingId(null);
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
                                {pendingExampleIds.has(example.id) ? (
                                  <span className="sidebar-inline-spinner" title="Updating example">
                                    <span className="loading-spinner small" />
                                  </span>
                                ) : (
                                  <button
                                    onClick={(e) => toggleExampleMenu(example.id, e)}
                                    className="btn-icon small btn-menu"
                                    title="More actions"
                                  >
                                    <MoreHorizontal size={12} />
                                  </button>
                                )}
                                {exampleMenuOpen === example.id && (
                                  <div className="request-menu example-menu" ref={exampleMenuRef}>
                                    {canEdit && (
                                      <>
                                        <button
                                          className="request-menu-item"
                                          onClick={(e) => handleExampleMenuAction('rename', example, request, e)}
                                        >
                                          <Edit2 size={14} />
                                          Rename
                                        </button>
                                        <button
                                          className="request-menu-item"
                                          onClick={(e) => handleExampleMenuAction('duplicate', example, request, e)}
                                        >
                                          <Copy size={14} />
                                          Duplicate
                                        </button>
                                      </>
                                    )}
                                    <button
                                      className="request-menu-item"
                                      onClick={(e) => handleExampleMenuAction('share', example, request, e)}
                                    >
                                      <Share2 size={14} />
                                      Share
                                    </button>
                                    {canEdit && (
                                      <>
                                        <div className="request-menu-divider" />
                                        <button
                                          className="request-menu-item danger"
                                          onClick={(e) => handleExampleMenuAction('delete', example, request, e)}
                                        >
                                          <Trash2 size={14} />
                                          Delete
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              childCollections.length === 0 && (
                <div className="no-requests" style={{ paddingLeft: `${28 + depth * 16}px` }}>
                  No requests
                </div>
              )
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar" style={{ width: width ? `${width}px` : undefined }}>
      <div className="sidebar-header">
        <h2>Collections</h2>
        <div className="sidebar-toolbar">
          <button
            onClick={handleScrollToActive}
            className="btn-icon small"
            title="Scroll to active request"
            disabled={!selectedRequest}
          >
            <Crosshair size={14} />
          </button>
          <button
            onClick={handleExpandAll}
            className="btn-icon small"
            title="Expand all folders"
          >
            <ChevronsUpDown size={14} />
          </button>
          <button
            onClick={handleCollapseAll}
            className="btn-icon small"
            title="Collapse all folders"
          >
            <ChevronsDownUp size={14} />
          </button>
          {canEdit && (
            <button
              onClick={onCreateCollection}
              className="btn-icon small"
              title={canAddCollection ? "New Collection" : "Select a workspace first"}
              disabled={!canAddCollection}
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-search">
        <Search size={14} />
        <input
          type="text"
          placeholder="Search APIs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="sidebar-content">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner medium" />
            <span className="loading-text">Loading collections...</span>
          </div>
        ) : collections.length === 0 ? (
          <div className="sidebar-empty">
            No collections yet.
            <br />
            Click + to create one.
          </div>
        ) : (
          rootCollections.map((collection) => renderCollection(collection))
        )}
      </div>

      {/* Move To Modal */}
      {moveModalRequest && (
        <div className="modal-overlay" onClick={handleCancelMove}>
          <div className="modal move-to-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Move "{moveModalRequest.name}" to...</h2>
              <button className="modal-close" onClick={handleCancelMove}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body move-to-body">
              <div className="move-to-tree">
                {rootCollections.map((collection) => (
                  <MoveToFolderItem
                    key={collection.id}
                    collection={collection}
                    allCollections={collections}
                    currentCollectionId={moveModalRequest.collection_id}
                    selectedId={selectedMoveFolder}
                    onSelect={handleSelectMoveFolder}
                    depth={0}
                  />
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={handleCancelMove}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirmMove}
                disabled={!selectedMoveFolder}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Move To Folder Item component
function MoveToFolderItem({ collection, allCollections, currentCollectionId, selectedId, onSelect, depth }) {
  const [expanded, setExpanded] = useState(true);
  const childCollections = allCollections.filter(c => c.parent_id === collection.id);
  const isCurrentFolder = collection.id === currentCollectionId;
  const isSelected = collection.id === selectedId;

  return (
    <div className="move-to-folder">
      <div
        className={`move-to-folder-item ${isCurrentFolder ? 'current' : ''} ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={() => !isCurrentFolder && onSelect(collection.id)}
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
        {isCurrentFolder && <span className="move-to-current-badge">Current</span>}
      </div>
      {expanded && childCollections.length > 0 && (
        <div className="move-to-children">
          {childCollections.map((child) => (
            <MoveToFolderItem
              key={child.id}
              collection={child}
              allCollections={allCollections}
              currentCollectionId={currentCollectionId}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
