import { useCallback } from 'react';
import * as data from '../data/index.js';

export function useRequestActions({
  prompt,
  confirm,
  toast,
  activeWorkspace,
  selectedRequest,
  openTabs,
  activeTabId,
  previewTabId,
  collections,
  setCollections,
  setPendingRequestIds,
  setPendingExampleIds,
  setPendingExampleListRequestIds,
  setPendingCollectionIds,
  setOpenTabs,
  setActiveTabId,
  setPreviewTabId,
  setConflictedTabs,
  setDeletedTabs,
  originalRequestsRef,
  markAsRecentlyModified,
}) {
  const withPendingId = useCallback(async (setter, id, action) => {
    setter((prev) => new Set([...prev, id]));
    try {
      return await action();
    } finally {
      setter((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const removeTabs = useCallback((tabIds) => {
    if (!tabIds.length) return;

    const tabsToRemove = new Set(tabIds);

    setOpenTabs((prev) => {
      const newTabs = prev.filter((tab) => !tabsToRemove.has(tab.id));

      if (activeTabId && tabsToRemove.has(activeTabId)) {
        setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
      }

      return newTabs;
    });

    if (previewTabId && tabsToRemove.has(previewTabId)) {
      setPreviewTabId(null);
    }

    setConflictedTabs((prev) => {
      const next = { ...prev };
      tabIds.forEach((tabId) => {
        delete next[tabId];
      });
      return next;
    });

    setDeletedTabs((prev) => {
      const next = new Set(prev);
      tabIds.forEach((tabId) => {
        next.delete(tabId);
      });
      return next;
    });

    tabIds.forEach((tabId) => {
      delete originalRequestsRef.current[tabId];
    });
  }, [
    activeTabId,
    originalRequestsRef,
    previewTabId,
    setActiveTabId,
    setConflictedTabs,
    setDeletedTabs,
    setOpenTabs,
    setPreviewTabId,
  ]);

  const openRequestInTab = useCallback(async (request, options = {}) => {
    const { replacePreview = true } = options;
    const tabId = `request-${request.id}`;
    const existingTab = openTabs.find((tab) => tab.id === tabId);
    if (existingTab) {
      setActiveTabId(tabId);
      return;
    }

    const fullRequest = await data.getRequest(request.id);

    originalRequestsRef.current[tabId] = JSON.stringify({
      method: fullRequest.method,
      url: fullRequest.url,
      headers: fullRequest.headers,
      body: fullRequest.body,
      body_type: fullRequest.body_type,
      form_data: fullRequest.form_data,
      auth_type: fullRequest.auth_type,
      auth_token: fullRequest.auth_token,
      pre_script: fullRequest.pre_script,
      post_script: fullRequest.post_script,
    });

    const hasBody = fullRequest.body_type && fullRequest.body_type !== 'none';
    const newTab = {
      id: tabId,
      type: 'request',
      entityId: request.id,
      request: fullRequest,
      dirty: false,
      response: null,
      activeDetailTab: hasBody ? 'body' : 'params',
    };

    setOpenTabs((prev) => {
      // Check again inside updater to avoid race conditions with stale closure
      if (prev.some((tab) => tab.id === tabId)) {
        return prev;
      }

      const previewTab = previewTabId ? prev.find((tab) => tab.id === previewTabId) : null;

      if (replacePreview && previewTab && !previewTab.dirty && !previewTab.isTemporary) {
        delete originalRequestsRef.current[previewTab.id];
        return prev.map((tab) => (tab.id === previewTabId ? newTab : tab));
      }

      return [...prev, newTab];
    });

    setActiveTabId(tabId);
    setPreviewTabId(tabId);
  }, [openTabs, originalRequestsRef, previewTabId, setActiveTabId, setOpenTabs, setPreviewTabId]);

  const openExampleInTab = useCallback(async (example, parentRequest, options = {}) => {
    const { replacePreview = true } = options;
    const tabId = `example-${example.id}`;
    const existingTab = openTabs.find((tab) => tab.id === tabId);
    if (existingTab) {
      setActiveTabId(tabId);
      return;
    }

    const fullExample = await data.getExample(example.id);

    originalRequestsRef.current[tabId] = JSON.stringify({
      name: fullExample.name,
      request_data: fullExample.request_data,
      response_data: fullExample.response_data,
    });

    const reqData = fullExample.request_data || {};
    const hasBody = reqData.body_type && reqData.body_type !== 'none';
    const newTab = {
      id: tabId,
      type: 'example',
      entityId: example.id,
      parentRequestId: parentRequest?.id || fullExample.request_id,
      example: fullExample,
      dirty: false,
      activeDetailTab: hasBody ? 'body' : 'params',
    };

    setOpenTabs((prev) => {
      // Check again inside updater to avoid race conditions with stale closure
      if (prev.some((tab) => tab.id === tabId)) {
        return prev;
      }

      const previewTab = previewTabId ? prev.find((tab) => tab.id === previewTabId) : null;

      if (replacePreview && previewTab && !previewTab.dirty && !previewTab.isTemporary) {
        delete originalRequestsRef.current[previewTab.id];
        return prev.map((tab) => (tab.id === previewTabId ? newTab : tab));
      }

      return [...prev, newTab];
    });

    setActiveTabId(tabId);
    setPreviewTabId(tabId);
  }, [openTabs, originalRequestsRef, previewTabId, setActiveTabId, setOpenTabs, setPreviewTabId]);

  const closeTab = useCallback(async (id, e, { force = false } = {}) => {
    if (e) e.stopPropagation();

    const tab = openTabs.find((item) => item.id === id);
    if (!force && tab?.dirty) {
      const confirmed = await confirm({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Are you sure you want to close this tab?',
        confirmText: 'Close',
        cancelText: 'Cancel',
        variant: 'danger',
      });
      if (!confirmed) return;
    }

    setOpenTabs((prev) => {
      const newTabs = prev.filter((item) => item.id !== id);
      if (activeTabId === id && newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });

    if (previewTabId === id) {
      setPreviewTabId(null);
    }

    setConflictedTabs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    setDeletedTabs((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    delete originalRequestsRef.current[id];
  }, [
    activeTabId,
    confirm,
    openTabs,
    originalRequestsRef,
    previewTabId,
    setActiveTabId,
    setConflictedTabs,
    setDeletedTabs,
    setOpenTabs,
    setPreviewTabId,
  ]);

  const handleCreateCollection = useCallback(async () => {
    const name = await prompt({
      title: 'New Collection',
      message: 'Enter a name for the new collection:',
      defaultValue: 'New Collection',
      placeholder: 'Collection name',
    });
    if (!name) return;

    try {
      const newCollection = await data.createCollection({ name, workspace_id: activeWorkspace?.id });
      markAsRecentlyModified(`collection-${newCollection.id}`);
      setCollections(prev => [...prev, { ...newCollection, requests: [] }]);
    } catch (err) {
      toast.error(err.message || 'Failed to create collection');
    }
  }, [activeWorkspace, markAsRecentlyModified, prompt, setCollections, toast]);

  const handleCreateSubCollection = useCallback(async (parentId) => {
    const name = await prompt({
      title: 'New Folder',
      message: 'Enter a name for the new folder:',
      defaultValue: 'New Folder',
      placeholder: 'Folder name',
    });
    if (!name) return;

    try {
      const newCollection = await withPendingId(setPendingCollectionIds, parentId, async () => {
        return await data.createCollection({ name, parent_id: parentId });
      });
      markAsRecentlyModified(`collection-${newCollection.id}`);
      setCollections(prev => [...prev, { ...newCollection, requests: [] }]);
    } catch (err) {
      toast.error(err.message || 'Failed to create folder');
    }
  }, [markAsRecentlyModified, prompt, setCollections, setPendingCollectionIds, toast, withPendingId]);

  const handleCreateRequest = useCallback(async (collectionId) => {
    try {
      const request = await withPendingId(setPendingRequestIds, `create:${collectionId}`, async () => data.createRequest({
        collection_id: collectionId,
        name: 'New Request',
      }));
      markAsRecentlyModified(`request-${request.id}`);
      setCollections((prev) => prev.map((collection) => (
        collection.id === collectionId
          ? { ...collection, requests: [...(collection.requests || []), { ...request, example_count: 0 }] }
          : collection
      )));
      openRequestInTab(request);
    } catch (err) {
      toast.error(err.message || 'Failed to create request');
    }
  }, [markAsRecentlyModified, openRequestInTab, setCollections, setPendingRequestIds, toast, withPendingId]);

  const handleDeleteCollection = useCallback(async (id) => {
    try {
      // Build the full set of IDs to mark BEFORE the API call
      const collectionIdsToRemove = new Set([id]);
      const requestIdsToRemove = new Set();

      // Find all descendant collections using current collections state
      let foundMore = true;
      while (foundMore) {
        foundMore = false;
        for (const col of collections) {
          if (col.parent_id && collectionIdsToRemove.has(col.parent_id) && !collectionIdsToRemove.has(col.id)) {
            collectionIdsToRemove.add(col.id);
            foundMore = true;
          }
        }
      }

      // Find all requests in those collections
      for (const col of collections) {
        if (collectionIdsToRemove.has(col.id) && col.requests) {
          col.requests.forEach(req => requestIdsToRemove.add(req.id));
        }
      }

      // Mark everything as recently modified BEFORE the API call
      collectionIdsToRemove.forEach(colId => markAsRecentlyModified(`collection-${colId}`));
      requestIdsToRemove.forEach(reqId => markAsRecentlyModified(`request-${reqId}`));

      await withPendingId(setPendingCollectionIds, id, async () => {
        await data.deleteCollection(id);
      });

      // Now remove from state
      setCollections(prev => prev.filter(col => !collectionIdsToRemove.has(col.id)));

      // Close tabs for requests in deleted collections
      setOpenTabs(prev => prev.filter(tab => {
        if (tab.type !== 'request') return true;
        return !collectionIdsToRemove.has(tab.request?.collection_id);
      }));
    } catch (err) {
      toast.error(err.message || 'Failed to delete collection');
    }
  }, [collections, markAsRecentlyModified, setPendingCollectionIds, setCollections, setOpenTabs, toast, withPendingId]);

  const handleDeleteRequest = useCallback(async (id) => {
    try {
      markAsRecentlyModified(`request-${id}`);
      await withPendingId(setPendingRequestIds, id, async () => {
        await data.deleteRequest(id);
      });
      setCollections((prev) => prev.map((collection) => ({
        ...collection,
        requests: (collection.requests || []).filter((request) => request.id !== id),
      })));
      const tabIdsToRemove = openTabs
        .filter((tab) => tab.id === `request-${id}` || (tab.type === 'example' && tab.parentRequestId === id))
        .map((tab) => tab.id);
      removeTabs(tabIdsToRemove);
    } catch (err) {
      toast.error(err.message || 'Failed to delete request');
    }
  }, [markAsRecentlyModified, openTabs, removeTabs, setCollections, setPendingRequestIds, toast, withPendingId]);

  const handleDuplicateRequest = useCallback(async (request) => {
    try {
      const duplicatedRequest = await data.createRequest({
        collection_id: request.collection_id,
        name: `${request.name} (Copy)`,
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
        body_type: request.body_type,
        auth_type: request.auth_type,
        auth_token: request.auth_token,
      });
      markAsRecentlyModified(`request-${duplicatedRequest.id}`);
      setCollections((prev) => prev.map((collection) => (
        collection.id === duplicatedRequest.collection_id
          ? { ...collection, requests: [...(collection.requests || []), { ...duplicatedRequest, example_count: 0 }] }
          : collection
      )));
      openRequestInTab(duplicatedRequest);
    } catch (err) {
      toast.error(err.message || 'Failed to duplicate request');
    }
  }, [markAsRecentlyModified, openRequestInTab, setCollections, toast]);

  const handleMoveRequest = useCallback(async (requestId, targetCollectionId) => {
    try {
      const updatedRequest = await withPendingId(setPendingRequestIds, requestId, async () => (
        data.moveRequest(requestId, targetCollectionId)
      ));
      const tabId = `request-${requestId}`;
      setOpenTabs((prev) => prev.map((tab) => (
        tab.id === tabId ? { ...tab, request: { ...tab.request, collection_id: targetCollectionId } } : tab
      )));
      setCollections((prev) => {
        const withoutRequest = prev.map((collection) => ({
          ...collection,
          requests: (collection.requests || []).filter((request) => request.id !== requestId),
        }));
        return withoutRequest.map((collection) => (
          collection.id === targetCollectionId
            ? { ...collection, requests: [...(collection.requests || []), { ...updatedRequest, example_count: updatedRequest.example_count ?? 0 }] }
            : collection
        ));
      });
      toast.success('Request moved successfully');
    } catch (err) {
      toast.error(err.message || 'Failed to move request');
    }
  }, [setCollections, setOpenTabs, setPendingRequestIds, toast, withPendingId]);

  const handleRenameCollection = useCallback(async (id, name) => {
    markAsRecentlyModified(`collection-${id}`);
    await withPendingId(setPendingCollectionIds, id, async () => {
      await data.updateCollection(id, { name });
    });
    setCollections(prev => prev.map(col => col.id === id ? { ...col, name } : col));
  }, [markAsRecentlyModified, setCollections, setPendingCollectionIds, withPendingId]);

  const handleRenameRequest = useCallback(async (id, name) => {
    const tabId = `request-${id}`;
    markAsRecentlyModified(tabId);
    const updated = await withPendingId(setPendingRequestIds, id, async () => data.updateRequest(id, { name }));
    setCollections((prev) => prev.map((collection) => ({
      ...collection,
      requests: (collection.requests || []).map((request) => (
        request.id === id ? { ...request, name: updated.name } : request
      )),
    })));
    setOpenTabs((prev) => prev.map((tab) => (
      tab.id === tabId ? { ...tab, request: { ...tab.request, name } } : tab
    )));
  }, [markAsRecentlyModified, setCollections, setOpenTabs, setPendingRequestIds, withPendingId]);

  const handleCreateExample = useCallback(async (requestId) => {
    const example = await withPendingId(setPendingExampleListRequestIds, requestId, async () => data.createExample({
      request_id: requestId,
      name: 'New Example',
      request_data: { method: 'GET', url: '', headers: [], body: '' },
      response_data: { status: 200, body: '', headers: [] },
    }));
    markAsRecentlyModified(`example-${example.id}`);
    setCollections((prev) => prev.map((collection) => ({
      ...collection,
      requests: (collection.requests || []).map((request) => (
        request.id === requestId ? { ...request, example_count: (request.example_count || 0) + 1 } : request
      )),
    })));
    openExampleInTab(example, { id: requestId });
    return example;
  }, [markAsRecentlyModified, openExampleInTab, setCollections, setPendingExampleListRequestIds, withPendingId]);

  const handleDeleteExample = useCallback(async (id, parentRequestId) => {
    const exampleTab = openTabs.find((tab) => tab.id === `example-${id}`);
    const resolvedParentRequestId = parentRequestId || exampleTab?.parentRequestId;
    markAsRecentlyModified(`example-${id}`);
    await withPendingId(setPendingExampleIds, id, async () => {
      await data.deleteExample(id);
    });
    if (resolvedParentRequestId) {
      setCollections((prev) => prev.map((collection) => ({
        ...collection,
        requests: (collection.requests || []).map((request) => (
          request.id === resolvedParentRequestId
            ? { ...request, example_count: Math.max((request.example_count || 1) - 1, 0) }
            : request
        )),
      })));
    }
    removeTabs([`example-${id}`]);
  }, [markAsRecentlyModified, openTabs, removeTabs, setCollections, setPendingExampleIds, withPendingId]);

  const handleDuplicateExample = useCallback(async (example) => {
    const duplicated = await withPendingId(setPendingExampleListRequestIds, example.request_id, async () => data.createExample({
      request_id: example.request_id,
      name: `${example.name} (Copy)`,
      request_data: example.request_data,
      response_data: example.response_data,
    }));
    markAsRecentlyModified(`example-${duplicated.id}`);
    setCollections((prev) => prev.map((collection) => ({
      ...collection,
      requests: (collection.requests || []).map((request) => (
        request.id === example.request_id ? { ...request, example_count: (request.example_count || 0) + 1 } : request
      )),
    })));
    openExampleInTab(duplicated, { id: example.request_id });
    return duplicated;
  }, [markAsRecentlyModified, openExampleInTab, setCollections, setPendingExampleListRequestIds, withPendingId]);

  const handleSaveAsExample = useCallback(async (exampleName, requestData, responseData) => {
    if (!selectedRequest?.id) return;

    const example = await withPendingId(setPendingExampleListRequestIds, selectedRequest.id, async () => data.createExample({
      request_id: selectedRequest.id,
      name: exampleName || 'New Example',
      request_data: requestData,
      response_data: responseData,
    }));
    markAsRecentlyModified(`example-${example.id}`);
    setCollections((prev) => prev.map((collection) => ({
      ...collection,
      requests: (collection.requests || []).map((request) => (
        request.id === selectedRequest.id ? { ...request, example_count: (request.example_count || 0) + 1 } : request
      )),
    })));
    openExampleInTab(example, selectedRequest);
    return example;
  }, [markAsRecentlyModified, openExampleInTab, selectedRequest, setCollections, setPendingExampleListRequestIds, withPendingId]);

  const handleRenameExample = useCallback(async (id, name) => {
    const tabId = `example-${id}`;
    markAsRecentlyModified(tabId);
    const updated = await withPendingId(setPendingExampleIds, id, async () => data.updateExample(id, { name }));
    setOpenTabs((prev) => prev.map((tab) => (
      tab.id === tabId ? { ...tab, example: { ...tab.example, name: updated.name } } : tab
    )));
    return updated;
  }, [markAsRecentlyModified, setOpenTabs, setPendingExampleIds, withPendingId]);

  const handleSelectRequest = useCallback((request) => {
    openRequestInTab(request);
  }, [openRequestInTab]);

  const handleOpenExample = useCallback((example, parentRequest) => {
    openExampleInTab(example, parentRequest);
  }, [openExampleInTab]);

  const handleSidebarDeleteExample = useCallback(async (id, parentRequestId) => {
    await handleDeleteExample(id, parentRequestId);
  }, [handleDeleteExample]);

  const handleImport = useCallback(async (importData) => {
    const loadingToast = toast.loading('Importing collection...');
    try {
      const result = await data.importCollection(importData, activeWorkspace?.id);
      // Fetch the newly imported collection tree and add to state
      if (result.rootCollectionId) {
        markAsRecentlyModified(`collection-${result.rootCollectionId}`);
        const newCollections = await data.getCollectionTree(result.rootCollectionId);
        // Mark all imported collections as recently modified
        newCollections.forEach(col => markAsRecentlyModified(`collection-${col.id}`));
        // Filter out duplicates (realtime events may have already added some)
        setCollections(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const uniqueNew = newCollections.filter(c => !existingIds.has(c.id));
          return [...prev, ...uniqueNew];
        });
      }
      toast.dismiss(loadingToast);
      toast.success('Collection imported successfully');
    } catch (err) {
      toast.dismiss(loadingToast);
      toast.error(err.message || 'Failed to import collection');
    }
  }, [activeWorkspace, markAsRecentlyModified, setCollections, toast]);

  const handleExportCollection = useCallback(async (collection) => {
    try {
      const exportData = await data.exportCollection(collection.id);
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collection.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported "${collection.name}" successfully`);
    } catch (err) {
      toast.error(err.message || 'Failed to export collection');
    }
  }, [toast]);

  const handleImportCurl = useCallback((parsed) => {
    const tempId = `temp-${Date.now()}`;
    const tempRequest = {
      id: tempId,
      name: 'Imported cURL',
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers,
      body: parsed.body,
      body_type: parsed.bodyType,
      isTemporary: true,
    };

    setOpenTabs((prev) => [...prev, {
      id: tempId,
      type: 'request',
      request: tempRequest,
      dirty: false,
      response: null,
      isTemporary: true,
    }]);
    setActiveTabId(tempId);
  }, [setActiveTabId, setOpenTabs]);

  const handleTryExample = useCallback(({
    method,
    url,
    headers,
    body,
    bodyType,
    formData,
    authType,
    authToken,
    exampleName,
  }) => {
    const tempId = `temp-${Date.now()}`;
    const tempRequest = {
      id: tempId,
      name: `Try: ${exampleName || 'Example'}`,
      method,
      url,
      headers,
      body: body || '',
      body_type: bodyType || 'none',
      form_data: formData || [],
      auth_type: authType,
      auth_token: authToken,
      isTemporary: true,
    };

    setOpenTabs((prev) => [...prev, {
      id: tempId,
      type: 'request',
      request: tempRequest,
      dirty: false,
      response: null,
      isTemporary: true,
    }]);
    setActiveTabId(tempId);
  }, [setActiveTabId, setOpenTabs]);

  return {
    openRequestInTab,
    openExampleInTab,
    closeTab,
    handleCreateCollection,
    handleCreateSubCollection,
    handleCreateRequest,
    handleDeleteCollection,
    handleDeleteRequest,
    handleDuplicateRequest,
    handleMoveRequest,
    handleRenameCollection,
    handleRenameRequest,
    handleCreateExample,
    handleDeleteExample,
    handleDuplicateExample,
    handleSaveAsExample,
    handleRenameExample,
    handleSelectRequest,
    handleOpenExample,
    handleSidebarDeleteExample,
    handleImport,
    handleExportCollection,
    handleImportCurl,
    handleTryExample,
  };
}
