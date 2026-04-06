import { useState } from 'react';
import { useToast } from '../components/Toast';
import { useDragPreview } from './useDragPreview';
import { METHOD_COLORS } from '../constants/methodColors';
import * as data from '../data/index.js';

export function useSidebarDragDrop(collections, getChildCollections, setCollections) {
  const toast = useToast();
  const setDragPreview = useDragPreview();

  const [draggedRequest, setDraggedRequest] = useState(null);
  const [dragOverRequest, setDragOverRequest] = useState(null);
  const [draggedFolder, setDraggedFolder] = useState(null);
  const [dragOverFolder, setDragOverFolder] = useState(null);
  const [draggedExample, setDraggedExample] = useState(null);
  const [dragOverExample, setDragOverExample] = useState(null);
  const [dragOverCollection, setDragOverCollection] = useState(null);
  const [folderDropZone, setFolderDropZone] = useState(null);

  const getReorderIndices = (items, draggedId, targetId, placement = 'before') => {
    const ids = items.map((item) => (typeof item === 'string' ? item : item.id));
    const draggedIndex = ids.indexOf(draggedId);
    const targetIndex = ids.indexOf(targetId);

    if (draggedIndex === -1 || targetIndex === -1) return null;

    const insertIndex = placement === 'after'
      ? (draggedIndex < targetIndex ? targetIndex : targetIndex + 1)
      : (draggedIndex < targetIndex ? targetIndex - 1 : targetIndex);

    return { draggedIndex, targetIndex, insertIndex };
  };

  const getRootCollectionId = (collectionId) => {
    let current = collections.find(c => c.id === collectionId);
    while (current?.parent_id) {
      current = collections.find(c => c.id === current.parent_id);
    }
    return current?.id;
  };

  const isSameRootCollection = (idA, idB) => {
    return getRootCollectionId(idA) === getRootCollectionId(idB);
  };

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

  // Request drag handlers
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

    if (draggedRequest.collectionId !== collectionId) {
      setDragOverRequest(request.id);
      return;
    }

    const sourceCollection = collections.find(c => c.id === collectionId);
    const indices = getReorderIndices(sourceCollection?.requests || [], draggedRequest.id, request.id, 'before');
    setDragOverRequest(indices && indices.insertIndex !== indices.draggedIndex ? request.id : null);
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

    if (draggedRequest.collectionId !== collectionId) {
      try {
        await data.moveRequest(draggedRequest.id, collectionId);
        const targetIds = requests.map(r => r.id);
        const targetIndex = targetIds.indexOf(targetRequest.id);
        targetIds.splice(targetIndex, 0, draggedRequest.id);
        await data.reorderRequests(collectionId, targetIds);
        // Optimistic update: move request between collections and apply new sort order
        setCollections(prev => {
          const movedReq = prev.flatMap(c => c.requests || []).find(r => r.id === draggedRequest.id);
          if (!movedReq) return prev;
          return prev.map(c => {
            if (c.id === draggedRequest.collectionId) {
              return { ...c, requests: (c.requests || []).filter(r => r.id !== draggedRequest.id) };
            }
            if (c.id === collectionId) {
              const updated = [...(c.requests || []).filter(r => r.id !== draggedRequest.id)];
              const tIdx = updated.findIndex(r => r.id === targetRequest.id);
              updated.splice(tIdx >= 0 ? tIdx : updated.length, 0, { ...movedReq, collection_id: collectionId });
              return { ...c, requests: updated.map((r, i) => ({ ...r, sort_order: i })) };
            }
            return c;
          });
        });
        toast.success('Request moved');
      } catch (err) {
        toast.error('Failed to move request');
      }
      setDraggedRequest(null);
      return;
    }

    const requestIds = requests.map(r => r.id);
    const indices = getReorderIndices(requests, draggedRequest.id, targetRequest.id, 'before');
    if (!indices || indices.insertIndex === indices.draggedIndex) {
      setDraggedRequest(null);
      return;
    }

    requestIds.splice(indices.draggedIndex, 1);
    const { insertIndex } = indices;
    requestIds.splice(insertIndex, 0, draggedRequest.id);

    try {
      await data.reorderRequests(collectionId, requestIds);
      // Optimistic update: apply new sort order to collection state
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        const reordered = requestIds.map((id, i) => {
          const req = (c.requests || []).find(r => r.id === id);
          return req ? { ...req, sort_order: i } : null;
        }).filter(Boolean);
        return { ...c, requests: reordered };
      }));
      toast.success('Request reordered');
    } catch (err) {
      toast.error('Failed to reorder requests');
    }

    setDraggedRequest(null);
  };

  // Collection/folder drag handlers
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
    const dragSourceId = draggedRequest?.collectionId || draggedFolder?.parent_id;
    if (dragSourceId && !isSameRootCollection(dragSourceId, collectionId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedFolder && draggedFolder.id !== collectionId) {
      const zone = getFolderDropZone(e);
      const targetCollection = collections.find(c => c.id === collectionId);
      const sameParent = draggedFolder.parent_id === targetCollection?.parent_id;

      if (zone !== 'inside' && sameParent) {
        const siblings = getChildCollections(targetCollection?.parent_id);
        const indices = getReorderIndices(siblings, draggedFolder.id, collectionId, zone);
        if (!indices || indices.insertIndex === indices.draggedIndex) {
          setFolderDropZone(null);
          setDragOverFolder(null);
          setDragOverCollection(null);
          return;
        }
      }

      setFolderDropZone(zone);
      if (zone === 'inside') {
        setDragOverCollection(collectionId);
        setDragOverFolder(null);
      } else {
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

    if (draggedFolder) {
      if (draggedFolder.id === collectionId) return;

      const targetCollection = collections.find(c => c.id === collectionId);
      const isSibling = draggedFolder.parent_id === targetCollection?.parent_id;
      const targetParentId = targetCollection?.parent_id;

      if (zone !== 'inside') {
        if (isDescendant(draggedFolder.id, collectionId)) return;

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

        const newSiblings = isSibling ? siblingCollections : getChildCollections(targetParentId);
        const indices = getReorderIndices(newSiblings, draggedFolder.id, collectionId, zone);
        if (!indices || indices.insertIndex === indices.draggedIndex) {
          setDraggedFolder(null);
          return;
        }

        const ids = newSiblings.map(c => c.id);
        if (indices.draggedIndex !== -1) ids.splice(indices.draggedIndex, 1);
        ids.splice(indices.insertIndex, 0, draggedFolder.id);

        try {
          await data.reorderCollections(targetParentId, ids);
          toast.success(isSibling ? 'Folder reordered' : 'Folder moved');
        } catch (err) {
          toast.error('Failed to reorder folders');
        }
        setDraggedFolder(null);
        return;
      }

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

    if (!draggedRequest || draggedRequest.collectionId === collectionId) return;
    try {
      await data.moveRequest(draggedRequest.id, collectionId);
      // Optimistic update: move request to target collection
      setCollections(prev => {
        const movedReq = prev.flatMap(c => c.requests || []).find(r => r.id === draggedRequest.id);
        if (!movedReq) return prev;
        return prev.map(c => {
          if (c.id === draggedRequest.collectionId) {
            return { ...c, requests: (c.requests || []).filter(r => r.id !== draggedRequest.id) };
          }
          if (c.id === collectionId) {
            return { ...c, requests: [...(c.requests || []), { ...movedReq, collection_id: collectionId }] };
          }
          return c;
        });
      });
      toast.success('Request moved');
    } catch (err) {
      toast.error('Failed to move request');
    }
    setDraggedRequest(null);
  };

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

  const handleExampleDragOver = (e, example, examples) => {
    if (!draggedExample || draggedExample.id === example.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedExample.requestId !== example.request_id) {
      setDragOverExample(example.id);
      return;
    }

    const indices = getReorderIndices(examples || [], draggedExample.id, example.id, 'before');
    setDragOverExample(indices && indices.insertIndex !== indices.draggedIndex ? example.id : null);
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
    const indices = getReorderIndices(examples, draggedExample.id, targetExample.id, 'before');
    if (!indices || indices.insertIndex === indices.draggedIndex) {
      setDraggedExample(null);
      return;
    }

    ids.splice(indices.draggedIndex, 1);
    ids.splice(indices.insertIndex, 0, draggedExample.id);

    try {
      await data.reorderExamples(requestId, ids);
    } catch (err) {
      console.error('Failed to reorder examples:', err);
    }

    setDraggedExample(null);
  };

  return {
    // State
    draggedRequest, dragOverRequest, draggedFolder, dragOverFolder,
    draggedExample, dragOverExample, dragOverCollection, folderDropZone,
    // Request handlers
    handleDragStart, handleDragEnd, handleDragOver, handleDragLeave, handleDrop,
    // Collection/folder handlers
    handleCollectionDragOver, handleCollectionDragLeave, handleCollectionDrop,
    handleFolderDragStart, handleFolderDragEnd,
    // Example handlers
    handleExampleDragStart, handleExampleDragEnd, handleExampleDragOver,
    handleExampleDragLeave, handleExampleDrop,
    // Helpers
    isSameRootCollection,
  };
}
