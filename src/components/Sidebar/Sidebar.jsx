import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, Trash2, FileText, MoreHorizontal, Edit2, Copy, Search, Plus, FolderPlus, X, Folder, Crosshair, ChevronsDownUp, ChevronsUpDown, Download, Link, Play } from 'lucide-react';
import * as data from '../../data/index.js';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';

import { METHOD_COLORS } from '../../constants/methodColors';

export function Sidebar({
  collections,
  activeTab,
  selectedRequest,
  onSelectRequest,
  onOpenCollection,
  onCreateCollection,
  onCreateSubCollection,
  onCreateRequest,
  onDeleteCollection,
  onDeleteRequest,
  onRenameCollection,
  onRenameRequest,
  onDuplicateRequest,
  onExportCollection,
  width,
  onOpenExample,
  onCreateExample,
  onDeleteExample,
  onDuplicateExample,
  onRenameExample,
  onCopyLink,
  pendingRequestIds = new Set(),
  pendingExampleIds = new Set(),
  pendingExampleListRequestIds = new Set(),
  pendingCollectionIds = new Set(),
  canAddCollection = true,
  selectedExample = null,
  canEdit = true,
  loading = false,
  revealRequestId = null,
  revealCollectionId = null,
  onRevealComplete,
  workflows = [],
  onOpenWorkflow,
  onCreateWorkflow,
  onDeleteWorkflow,
  onRenameWorkflow,
  onDuplicateWorkflow,
  onRunWorkflow,
  onViewDocs,
}) {
  const confirm = useConfirm();
  const toast = useToast();
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
  const [showWorkflowsOnly, setShowWorkflowsOnly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(null);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(null);
  const [draggedRequest, setDraggedRequest] = useState(null);
  const [dragOverRequest, setDragOverRequest] = useState(null);
  const [draggedFolder, setDraggedFolder] = useState(null);
  const [dragOverFolder, setDragOverFolder] = useState(null);
  const [draggedExample, setDraggedExample] = useState(null);
  const [dragOverExample, setDragOverExample] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [exampleMenuOpen, setExampleMenuOpen] = useState(null);
  const [dragOverCollection, setDragOverCollection] = useState(null);
  const menuRef = useRef(null);
  const collectionMenuRef = useRef(null);
  const exampleMenuRef = useRef(null);
  const collectionsRef = useRef(collections);
  const dragPreviewRef = useRef(null);

  // Custom drag image helper
  const setDragPreview = useCallback((e, label, color) => {
    let el = dragPreviewRef.current;
    if (!el) {
      el = document.createElement('div');
      el.className = 'sidebar-drag-preview';
      document.body.appendChild(el);
      dragPreviewRef.current = el;
    }
    el.innerHTML = color
      ? `<span style="color:${color};font-weight:700;font-size:10px;margin-right:4px">${label.split(' ')[0] || ''}</span>${label.includes(' ') ? label.slice(label.indexOf(' ') + 1) : label}`
      : label;
    el.style.display = 'block';
    e.dataTransfer.setDragImage(el, 12, 12);
    // Hide after browser captures it
    requestAnimationFrame(() => { if (el) el.style.display = 'none'; });
  }, []);

  // Cleanup drag preview on unmount
  useEffect(() => {
    return () => {
      if (dragPreviewRef.current) {
        document.body.removeChild(dragPreviewRef.current);
        dragPreviewRef.current = null;
      }
    };
  }, []);

  // Reposition menus that overflow the available space
  useEffect(() => {
    // Find the bottom boundary — the workflow divider or sidebar bottom
    const divider = document.querySelector('.sidebar-workflows-divider');
    const sidebar = document.querySelector('.sidebar');
    const boundaryBottom = divider
      ? divider.getBoundingClientRect().top
      : sidebar
        ? sidebar.getBoundingClientRect().bottom
        : window.innerHeight;

    const refs = [menuRef, collectionMenuRef, exampleMenuRef];
    for (const ref of refs) {
      const el = ref.current;
      if (!el) continue;
      el.style.top = '';
      el.style.bottom = '';
      const rect = el.getBoundingClientRect();
      if (rect.bottom > boundaryBottom - 8) {
        el.style.top = 'auto';
        el.style.bottom = 'calc(100% + 3px)';
      }
    }
  }, [menuOpen, collectionMenuOpen, exampleMenuOpen]);

  // Save expanded state to localStorage
  useEffect(() => {
    localStorage.setItem('expandedCollections', JSON.stringify([...expandedCollections]));
  }, [expandedCollections]);

  useEffect(() => {
    localStorage.setItem('expandedRequests', JSON.stringify([...expandedRequests]));
  }, [expandedRequests]);

  // Listen for expanded state updates from "Open in App" transfer
  useEffect(() => {
    const handler = () => {
      const savedC = localStorage.getItem('expandedCollections');
      const savedR = localStorage.getItem('expandedRequests');
      if (savedC) setExpandedCollections(new Set(JSON.parse(savedC)));
      if (savedR) setExpandedRequests(new Set(JSON.parse(savedR)));
    };
    window.addEventListener('expanded-state-updated', handler);
    return () => window.removeEventListener('expanded-state-updated', handler);
  }, []);

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
    return collections
      .filter(c => !c.parent_id)
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }, [collections]);

  const getChildCollections = (parentId) => {
    return collections
      .filter(c => c.parent_id === parentId)
      .sort((a, b) => {
        const sortA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const sortB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (sortA !== sortB) return sortA - sortB;
        return (a.created_at || 0) - (b.created_at || 0);
      });
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

  // Check if collection name matches search
  const collectionMatchesSearch = (collection) => {
    if (!searchQuery.trim()) return false;
    return collection.name.toLowerCase().includes(searchQuery.toLowerCase());
  };

  // Check if collection or its children have matching requests or matching name
  const hasMatchingRequests = (collection) => {
    if (!searchQuery.trim()) return true;
    if (collectionMatchesSearch(collection)) return true;
    const filteredReqs = filterRequests(collection.requests);
    if (filteredReqs.length > 0) return true;
    const children = getChildCollections(collection.id);
    return children.some(child => hasMatchingRequests(child));
  };

  const toggleCollectionExpand = (collectionId, e) => {
    e.stopPropagation();
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  };

  const handleCollectionClick = (collection) => {
    const id = collection.id;
    const isExpanded = expandedCollections.has(id);
    // Always open/focus the tab
    onOpenCollection?.(collection);
    // Expand if collapsed
    if (!isExpanded) {
      setExpandedCollections((prev) => new Set([...prev, id]));
    }
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

  const handleWorkflowRename = (wfId) => {
    if (editingName.trim()) {
      onRenameWorkflow?.(wfId, editingName);
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
        setExpandedCollections(prev => new Set([...prev, collection.id]));
        break;
      case 'add-workflow':
        onCreateWorkflow?.(collection.id);
        setExpandedCollections(prev => new Set([...prev, collection.id]));
        break;
      case 'rename':
        setEditingId(collection.id);
        setEditingName(collection.name);
        break;
      case 'export':
        onExportCollection?.(collection);
        break;
      case 'view-docs':
        onViewDocs?.(collection);
        break;
      case 'copy-link':
        onCopyLink?.(collection.parent_id ? 'folder' : 'collection', collection.id);
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
      case 'copy-link':
        onCopyLink?.('request', request.id);
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
      case 'copy-link':
        onCopyLink?.('example', example.id);
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
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', request.id);
    e.dataTransfer.setData('text/x-request-id', request.id);
    setDragPreview(e, `${request.method} ${request.name}`, METHOD_COLORS[request.method]);
  };

  const handleDragEnd = () => {
    setDraggedRequest(null);
    setDragOverRequest(null);
  };

  const handleDragOver = (e, request, collectionId) => {
    if (!draggedRequest || draggedRequest.id === request.id) return;
    if (!isSameRootCollection(draggedRequest.collectionId, collectionId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedRequest.id !== request.id) {
      setDragOverRequest(request.id);
    }
  };

  const handleDragLeave = () => {
    setDragOverRequest(null);
  };

  const handleDrop = async (e, targetRequest, collectionId, requests) => {
    e.preventDefault();
    setDragOverRequest(null);
    setDragOverCollection(null);

    if (!draggedRequest || draggedRequest.id === targetRequest.id) return;
    if (!isSameRootCollection(draggedRequest.collectionId, collectionId)) return;

    // Cross-folder move: move then reorder in the target
    if (draggedRequest.collectionId !== collectionId) {
      try {
        await data.moveRequest(draggedRequest.id, collectionId);
        const targetIds = requests.map(r => r.id);
        const targetIndex = targetIds.indexOf(targetRequest.id);
        targetIds.splice(targetIndex, 0, draggedRequest.id);
        await data.reorderRequests(collectionId, targetIds);
        toast.success('Request moved');
      } catch (err) {
        toast.error('Failed to move request');
      }
      setDraggedRequest(null);
      return;
    }

    // Same-collection reorder
    const requestIds = requests.map(r => r.id);
    const draggedIndex = requestIds.indexOf(draggedRequest.id);
    const targetIndex = requestIds.indexOf(targetRequest.id);

    requestIds.splice(draggedIndex, 1);
    requestIds.splice(targetIndex, 0, draggedRequest.id);

    try {
      await data.reorderRequests(collectionId, requestIds);
      toast.success('Request reordered');
    } catch (err) {
      toast.error('Failed to reorder requests');
    }

    setDraggedRequest(null);
  };

  // Drop onto a collection/folder header
  // folderDropZone: 'before' | 'inside' | 'after' — determined by mouse Y position
  const [folderDropZone, setFolderDropZone] = useState(null);

  const getFolderDropZone = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    if (ratio < 0.3) return 'before';
    if (ratio > 0.7) return 'after';
    return 'inside';
  };

  const handleCollectionDragOver = (e, collectionId) => {
    if (!draggedRequest && !draggedFolder) return;
    // Block cross-collection moves
    const dragSourceId = draggedRequest?.collectionId || draggedFolder?.parent_id;
    if (dragSourceId && !isSameRootCollection(dragSourceId, collectionId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedFolder && draggedFolder.id !== collectionId) {
      const zone = getFolderDropZone(e);
      setFolderDropZone(zone);
      if (zone === 'inside') {
        setDragOverCollection(collectionId);
        setDragOverFolder(null);
      } else {
        // Edge: show reorder line (works for siblings and non-siblings)
        setDragOverFolder(collectionId);
        setDragOverCollection(null);
      }
    } else {
      setDragOverCollection(collectionId);
    }
  };

  const handleCollectionDragLeave = () => {
    setDragOverCollection(null);
    setDragOverFolder(null);
    setFolderDropZone(null);
  };

  const handleCollectionDrop = async (e, collectionId, siblingCollections) => {
    e.preventDefault();
    const zone = folderDropZone;
    setDragOverCollection(null);
    setDragOverFolder(null);
    setFolderDropZone(null);

    // Folder drag: reorder (edges) or reparent (center)
    if (draggedFolder) {
      if (draggedFolder.id === collectionId) return;

      const targetCollection = collections.find(c => c.id === collectionId);
      const isSibling = draggedFolder.parent_id === targetCollection?.parent_id;
      const targetParentId = targetCollection?.parent_id;

      // Edge drop → place beside the target (as sibling of target)
      if (zone !== 'inside') {
        if (isDescendant(draggedFolder.id, collectionId)) return;

        // If not already a sibling, move to target's parent first
        if (!isSibling) {
          if (draggedFolder.parent_id === targetParentId) { setDraggedFolder(null); return; }
          try {
            await data.moveCollection(draggedFolder.id, targetParentId);
          } catch (err) {
            toast.error('Failed to move folder');
            setDraggedFolder(null);
            return;
          }
        }

        // Reorder among the target's siblings
        const newSiblings = isSibling
          ? siblingCollections
          : getChildCollections(targetParentId);
        const ids = newSiblings.map(c => c.id);

        // Remove dragged from current position (if present)
        const draggedIndex = ids.indexOf(draggedFolder.id);
        if (draggedIndex !== -1) ids.splice(draggedIndex, 1);

        // Insert at target position
        let targetIndex = ids.indexOf(collectionId);
        if (targetIndex === -1) { setDraggedFolder(null); return; }
        if (zone === 'after') targetIndex += 1;
        ids.splice(targetIndex, 0, draggedFolder.id);

        try {
          await data.reorderCollections(targetParentId, ids);
          toast.success(isSibling ? 'Folder reordered' : 'Folder moved');
        } catch (err) {
          toast.error('Failed to reorder folders');
        }
        setDraggedFolder(null);
        return;
      }

      // Center drop → reparent (move into target)
      if (draggedFolder.parent_id === collectionId) return;
      if (isDescendant(draggedFolder.id, collectionId)) return;
      try {
        await data.moveCollection(draggedFolder.id, collectionId);
        toast.success('Folder moved');
      } catch (err) {
        toast.error('Failed to move folder');
      }
      setDraggedFolder(null);
      return;
    }

    // Dropping a request into a folder
    if (!draggedRequest || draggedRequest.collectionId === collectionId) return;

    try {
      await data.moveRequest(draggedRequest.id, collectionId);
      toast.success('Request moved');
    } catch (err) {
      toast.error('Failed to move request');
    }

    setDraggedRequest(null);
  };

  // Find the root (top-level) collection for any collection ID
  const getRootCollectionId = (collectionId) => {
    let current = collections.find(c => c.id === collectionId);
    while (current?.parent_id) {
      current = collections.find(c => c.id === current.parent_id);
    }
    return current?.id;
  };

  // Check if two collection IDs belong to the same top-level collection
  const isSameRootCollection = (idA, idB) => {
    return getRootCollectionId(idA) === getRootCollectionId(idB);
  };

  // Check if targetId is a descendant of parentId (prevent circular moves)
  const isDescendant = (parentId, targetId) => {
    const check = (id) => {
      const children = collections.filter(c => c.parent_id === id);
      for (const child of children) {
        if (child.id === targetId) return true;
        if (check(child.id)) return true;
      }
      return false;
    };
    return check(parentId);
  };

  // Folder drag handlers (only for folders, not top-level collections)
  const handleFolderDragStart = (e, collection) => {
    setDraggedFolder(collection);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', collection.id);
    setDragPreview(e, `📁 ${collection.name}`);
  };

  const handleFolderDragEnd = () => {
    setDraggedFolder(null);
    setDragOverFolder(null);
    setDragOverCollection(null);
    setFolderDropZone(null);
  };

  // Example drag handlers
  const handleExampleDragStart = (e, example, requestId) => {
    setDraggedExample({ ...example, requestId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', example.id);
    e.stopPropagation();
    setDragPreview(e, `📄 ${example.name}`);
  };

  const handleExampleDragEnd = () => {
    setDraggedExample(null);
    setDragOverExample(null);
  };

  const handleExampleDragOver = (e, example) => {
    if (!draggedExample || draggedExample.id === example.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverExample(example.id);
  };

  const handleExampleDragLeave = () => {
    setDragOverExample(null);
  };

  const handleExampleDrop = async (e, targetExample, requestId, examples) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverExample(null);

    if (!draggedExample || draggedExample.id === targetExample.id) return;
    if (draggedExample.requestId !== requestId) return;

    const ids = examples.map(ex => ex.id);
    const draggedIndex = ids.indexOf(draggedExample.id);
    const targetIndex = ids.indexOf(targetExample.id);
    if (draggedIndex === -1 || targetIndex === -1) return;

    ids.splice(draggedIndex, 1);
    ids.splice(targetIndex, 0, draggedExample.id);

    try {
      await data.reorderExamples(requestId, ids);
    } catch (err) {
      console.error('Failed to reorder examples:', err);
    }

    setDraggedExample(null);
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

  // Scroll to active item (request or example) in sidebar
  const handleScrollToActive = () => {
    // If a workflow tab is active, scroll to it in the workflows list
    if (activeTab?.type === 'workflow') {
      const el = document.querySelector('.sidebar-workflow-item.active');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const isExample = !!selectedExample;
    const targetRequestId = isExample ? selectedExample.request_id : selectedRequest?.id;
    if (!targetRequestId) return;

    // Find the collection containing this request and expand it + all parents
    const collectionsToExpand = new Set();
    const requestsToExpand = new Set();

    for (const collection of collections) {
      if (collection.requests?.some(r => r.id === targetRequestId)) {
        collectionsToExpand.add(collection.id);
        let parent = collections.find(c => c.id === collection.parent_id);
        while (parent) {
          collectionsToExpand.add(parent.id);
          parent = collections.find(c => c.id === parent.parent_id);
        }
        break;
      }
    }

    // If scrolling to an example, also expand the parent request
    if (isExample) {
      requestsToExpand.add(targetRequestId);
    }

    setExpandedCollections(prev => new Set([...prev, ...collectionsToExpand]));
    if (requestsToExpand.size > 0) {
      setExpandedRequests(prev => new Set([...prev, ...requestsToExpand]));
    }

    // Scroll to the element after a short delay to allow expansion
    setTimeout(() => {
      const selector = isExample
        ? `.example-item-sidebar.selected`
        : `.request-item.selected`;
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  // Auto-reveal collection/folder when revealCollectionId is set (e.g., from shared link)
  useEffect(() => {
    if (!revealCollectionId || collections.length === 0) return;

    // Expand all parent collections + the target itself
    const collectionsToExpand = new Set();
    let currentId = revealCollectionId;
    while (currentId) {
      collectionsToExpand.add(currentId);
      const col = collections.find((c) => c.id === currentId);
      currentId = col?.parent_id;
    }

    setExpandedCollections((prev) => new Set([...prev, ...collectionsToExpand]));

    setTimeout(() => {
      const el = document.querySelector(`[data-collection-id="${revealCollectionId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      onRevealComplete?.();
    }, 100);
  }, [revealCollectionId, collections, onRevealComplete]);

  // Recursive collection renderer
  const renderCollection = (collection, depth = 0, parentMatched = false) => {
    const thisMatches = collectionMatchesSearch(collection);
    const showAll = parentMatched || thisMatches;

    // Skip collections with no matching content when searching (unless a parent matched)
    if (searchQuery.trim() && !showAll && !hasMatchingRequests(collection)) {
      return null;
    }

    // Workflows-only mode: skip folders (only show root collections)
    if (showWorkflowsOnly && collection.parent_id) {
      return null;
    }

    const childCollections = getChildCollections(collection.id);
    const siblingCollections = collection.parent_id ? getChildCollections(collection.parent_id) : [];
    // If this collection or a parent matches, show all requests; otherwise filter
    const filteredReqs = (searchQuery.trim() && showAll)
      ? (collection.requests || [])
      : filterRequests(collection.requests);
    // Auto-expand when searching
    const isExpanded = searchQuery.trim() ? true : expandedCollections.has(collection.id);
    const hasChildren = childCollections.length > 0 || (collection.requests?.length > 0);
    const isFolder = !!collection.parent_id;
    const collectionWorkflows = !isFolder ? workflows.filter(w => w.collection_id === collection.id) : [];
    const isFolderDraggable = isFolder && canEdit;

    return (
      <div key={collection.id} className={`collection ${dragOverCollection === collection.id ? 'drag-collection-over' : ''}`}>
        <div
          className={`collection-header ${dragOverCollection === collection.id ? 'drop-target' : ''} ${draggedFolder?.id === collection.id ? 'dragging' : ''} ${dragOverFolder === collection.id && folderDropZone === 'before' ? 'folder-drag-over' : ''} ${dragOverFolder === collection.id && folderDropZone === 'after' ? 'folder-drag-after' : ''}`}
          data-collection-id={collection.id}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => handleCollectionClick(collection)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); toggleCollectionMenu(collection.id, e); }}
          draggable={isFolderDraggable}
          onDragStart={isFolderDraggable ? (e) => handleFolderDragStart(e, collection) : undefined}
          onDragEnd={isFolderDraggable ? handleFolderDragEnd : undefined}
          onDragOver={(e) => handleCollectionDragOver(e, collection.id)}
          onDragLeave={handleCollectionDragLeave}
          onDrop={(e) => handleCollectionDrop(e, collection.id, siblingCollections)}
        >
          <span className="collection-arrow" onClick={hasChildren ? (e) => toggleCollectionExpand(collection.id, e) : undefined}>
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
                    {!collection.parent_id && (
                      <button
                        className="request-menu-item"
                        onClick={(e) => handleCollectionMenuAction('add-workflow', collection, e)}
                      >
                        <Play size={14} />
                        Add Workflow
                      </button>
                    )}
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
                  <>
                    <button
                      className="request-menu-item"
                      onClick={(e) => handleCollectionMenuAction('export', collection, e)}
                    >
                      <Download size={14} />
                      Export
                    </button>
                    <button
                      className="request-menu-item"
                      onClick={(e) => handleCollectionMenuAction('view-docs', collection, e)}
                    >
                      <FileText size={14} />
                      View Docs
                    </button>
                  </>
                )}
                <button
                  className="request-menu-item"
                  onClick={(e) => handleCollectionMenuAction('copy-link', collection, e)}
                >
                  <Link size={14} />
                  Copy Link
                </button>
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
            {/* Render child collections (skip in workflows-only mode) */}
            {!showWorkflowsOnly && childCollections.map(child => renderCollection(child, depth + 1, showAll))}

            {/* Render requests (skip in workflows-only mode) */}
            {!showWorkflowsOnly && filteredReqs?.length > 0 ? (
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
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(request.id, e); }}
                        draggable={canEdit}
                        onDragStart={canEdit ? (e) => handleDragStart(e, request, collection.id) : undefined}
                        onDragEnd={canEdit ? handleDragEnd : undefined}
                        onDragOver={canEdit ? (e) => handleDragOver(e, request, collection.id) : undefined}
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
                                </>
                              )}
                              <button
                                className="request-menu-item"
                                onClick={(e) => handleMenuAction('copy-link', request, e)}
                              >
                                <Link size={14} />
                                Copy Link
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
                              className={`example-item-sidebar ${selectedExample?.id === example.id ? 'selected' : ''} ${draggedExample?.id === example.id ? 'dragging' : ''} ${dragOverExample === example.id ? 'drag-over' : ''}`}
                              data-example-id={example.id}
                              onClick={() => onOpenExample?.(example, request)}
                              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); toggleExampleMenu(example.id, e); }}
                              draggable={canEdit}
                              onDragStart={canEdit ? (e) => handleExampleDragStart(e, example, request.id) : undefined}
                              onDragEnd={canEdit ? handleExampleDragEnd : undefined}
                              onDragOver={canEdit ? (e) => handleExampleDragOver(e, example) : undefined}
                              onDragLeave={canEdit ? handleExampleDragLeave : undefined}
                              onDrop={canEdit ? (e) => handleExampleDrop(e, example, request.id, examples) : undefined}
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
                                      onClick={(e) => handleExampleMenuAction('copy-link', example, request, e)}
                                    >
                                      <Link size={14} />
                                      Copy Link
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
              !showWorkflowsOnly && childCollections.length === 0 && !collection.parent_id && collectionWorkflows.length === 0 && (
                <div className="no-requests" style={{ paddingLeft: `${28 + depth * 16}px` }}>
                  No requests
                </div>
              )
            )}

            {/* Workflows (root collections only) */}
            {!collection.parent_id && collectionWorkflows.length > 0 && (
              <div className="collection-workflows" style={{ paddingLeft: `${20 + depth * 16}px` }}>
                {collectionWorkflows.map(wf => (
                  <div
                    key={wf.id}
                    className={`sidebar-workflow-item ${activeTab?.type === 'workflow' && activeTab?.entityId === wf.id ? 'active' : ''}`}
                    onClick={() => editingId !== `workflow-${wf.id}` && onOpenWorkflow(wf)}
                  >
                    <Play size={11} className="workflow-play-icon" />
                    {editingId === `workflow-${wf.id}` ? (
                      <input
                        className="rename-input"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => handleWorkflowRename(wf.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleWorkflowRename(wf.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="workflow-item-label">
                        <span className="workflow-item-name">{wf.name}</span>
                        <span className="workflow-item-count">{(wf.steps || []).length}</span>
                      </span>
                    )}
                    <div className="workflow-item-actions">
                      {canEdit && editingId !== `workflow-${wf.id}` && (
                        <>
                          <button className="btn-icon small" onClick={(e) => { e.stopPropagation(); onRunWorkflow?.(wf); }} title="Run">
                            <Play size={11} />
                          </button>
                          <button className="btn-icon small" onClick={(e) => { e.stopPropagation(); setEditingId(`workflow-${wf.id}`); setEditingName(wf.name); }} title="Rename">
                            <Edit2 size={11} />
                          </button>
                          <button className="btn-icon small" onClick={(e) => { e.stopPropagation(); onDuplicateWorkflow?.(wf); }} title="Duplicate">
                            <Copy size={11} />
                          </button>
                          <button className="btn-icon small" onClick={async (e) => {
                            e.stopPropagation();
                            const confirmed = await confirm({ title: 'Delete Workflow', message: `Delete "${wf.name}"?`, confirmText: 'Delete', variant: 'danger' });
                            if (confirmed) onDeleteWorkflow(wf);
                          }} title="Delete">
                            <Trash2 size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
            title="Scroll to active item"
            disabled={!selectedRequest && !selectedExample && activeTab?.type !== 'workflow'}
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
          <button
            onClick={() => setShowWorkflowsOnly(prev => !prev)}
            className={`btn-icon small ${showWorkflowsOnly ? 'active' : ''}`}
            title={showWorkflowsOnly ? 'Show all collections' : 'Show workflows only'}
          >
            <Play size={14} />
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

    </div>
  );
}

