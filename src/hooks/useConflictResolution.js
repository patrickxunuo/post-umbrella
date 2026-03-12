import { useCallback, useState } from 'react';
import * as data from '../data/index.js';

export function useConflictResolution({
  toast,
  openTabs,
  activeTabId,
  conflictedTabs,
  setConflictedTabs,
  deletedTabs,
  setDeletedTabs,
  setPendingRequestIds,
  setPendingExampleIds,
  setOpenTabs,
  setActiveTabId,
  originalRequestsRef,
  markAsRecentlyModified,
  openRequestInTab,
  openExampleInTab,
}) {
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingSaveTabId, setPendingSaveTabId] = useState(null);

  const doSaveRequest = useCallback(async (requestData, tabId) => {
    if (!tabId) return;
    const tab = openTabs.find((item) => item.id === tabId);
    if (!tab) return;

    try {
      setPendingRequestIds((prev) => new Set([...prev, tab.entityId]));
      markAsRecentlyModified(tabId);

      const updated = await data.updateRequest(tab.entityId, requestData);
      const savedPreScript = updated.pre_script ?? requestData.pre_script ?? '';
      const savedPostScript = updated.post_script ?? requestData.post_script ?? '';

      originalRequestsRef.current[tabId] = JSON.stringify({
        method: updated.method,
        url: updated.url,
        headers: updated.headers,
        body: updated.body,
        body_type: updated.body_type,
        form_data: updated.form_data,
        auth_type: updated.auth_type,
        auth_token: updated.auth_token,
        pre_script: savedPreScript,
        post_script: savedPostScript,
      });

      setOpenTabs((prev) => prev.map((item) => (
        item.id === tabId
          ? {
              ...item,
              request: {
                ...updated,
                pre_script: savedPreScript,
                post_script: savedPostScript,
              },
              dirty: false,
            }
          : item
      )));

      setConflictedTabs((prev) => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    } catch (err) {
      toast.error(err.message || 'Failed to save request');
    } finally {
      setPendingRequestIds((prev) => {
        const next = new Set(prev);
        next.delete(tab.entityId);
        return next;
      });
    }
  }, [markAsRecentlyModified, openTabs, originalRequestsRef, setConflictedTabs, setOpenTabs, setPendingRequestIds, toast]);

  const doSaveExample = useCallback(async (exampleData, tabId) => {
    if (!tabId) return;
    const tab = openTabs.find((item) => item.id === tabId);
    if (!tab) return;

    try {
      setPendingExampleIds((prev) => new Set([...prev, tab.entityId]));
      markAsRecentlyModified(tabId);

      const updated = await data.updateExample(tab.entityId, exampleData);

      originalRequestsRef.current[tabId] = JSON.stringify({
        name: updated.name,
        request_data: updated.request_data,
        response_data: updated.response_data,
      });

      setOpenTabs((prev) => prev.map((item) => (
        item.id === tabId ? { ...item, example: updated, dirty: false } : item
      )));

      setConflictedTabs((prev) => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    } catch (err) {
      toast.error(err.message || 'Failed to save example');
    } finally {
      setPendingExampleIds((prev) => {
        const next = new Set(prev);
        next.delete(tab.entityId);
        return next;
      });
    }
  }, [markAsRecentlyModified, openTabs, originalRequestsRef, setConflictedTabs, setOpenTabs, setPendingExampleIds, toast]);

  const handleSaveRequest = useCallback(async (requestData) => {
    if (!activeTabId) return;

    if (conflictedTabs[activeTabId] || deletedTabs.has(activeTabId)) {
      setPendingSaveTabId(activeTabId);
      setShowConflictModal(true);
      return;
    }

    await doSaveRequest(requestData, activeTabId);
  }, [activeTabId, conflictedTabs, deletedTabs, doSaveRequest]);

  const handleSaveExample = useCallback(async (exampleData) => {
    if (!activeTabId) return;

    if (conflictedTabs[activeTabId] || deletedTabs.has(activeTabId)) {
      setPendingSaveTabId(activeTabId);
      setShowConflictModal(true);
      return;
    }

    await doSaveExample(exampleData, activeTabId);
  }, [activeTabId, conflictedTabs, deletedTabs, doSaveExample]);

  const handleOverwriteConflict = useCallback(async () => {
    if (!pendingSaveTabId) return;
    const tab = openTabs.find((item) => item.id === pendingSaveTabId);
    if (!tab) return;

    const isDeleted = deletedTabs.has(pendingSaveTabId);

    if (isDeleted) {
      setOpenTabs((prev) => prev.filter((item) => item.id !== pendingSaveTabId));
      delete originalRequestsRef.current[pendingSaveTabId];
      setDeletedTabs((prev) => {
        const next = new Set(prev);
        next.delete(pendingSaveTabId);
        return next;
      });

      if (tab.type === 'example') {
        const newExample = await data.createExample({
          request_id: tab.parentRequestId,
          name: tab.example.name,
          request_data: tab.example.request_data,
          response_data: tab.example.response_data,
        });
        openExampleInTab(newExample, { id: tab.parentRequestId });
      } else {
        const newRequest = await data.createRequest({
          collection_id: tab.request.collection_id,
          name: tab.request.name,
          method: tab.request.method,
          url: tab.request.url,
          headers: tab.request.headers,
          body: tab.request.body,
          body_type: tab.request.body_type,
          auth_type: tab.request.auth_type,
          auth_token: tab.request.auth_token,
          params: tab.request.params,
          form_data: tab.request.form_data,
        });
        openRequestInTab(newRequest);
      }
    } else if (tab.type === 'example') {
      await doSaveExample({
        name: tab.example.name,
        request_data: tab.example.request_data,
        response_data: tab.example.response_data,
      }, pendingSaveTabId);
    } else {
      await doSaveRequest({
        method: tab.request.method,
        url: tab.request.url,
        headers: tab.request.headers,
        body: tab.request.body,
        body_type: tab.request.body_type,
        auth_type: tab.request.auth_type,
        auth_token: tab.request.auth_token,
      }, pendingSaveTabId);
    }

    setShowConflictModal(false);
    setPendingSaveTabId(null);
  }, [deletedTabs, doSaveExample, doSaveRequest, openExampleInTab, openRequestInTab, openTabs, originalRequestsRef, pendingSaveTabId, setDeletedTabs, setOpenTabs]);

  const handleDiscardChanges = useCallback(() => {
    if (!pendingSaveTabId) return;
    const tab = openTabs.find((item) => item.id === pendingSaveTabId);
    const isDeleted = deletedTabs.has(pendingSaveTabId);

    if (isDeleted) {
      setOpenTabs((prev) => {
        const newTabs = prev.filter((item) => item.id !== pendingSaveTabId);
        if (activeTabId === pendingSaveTabId && newTabs.length > 0) {
          setActiveTabId(newTabs[newTabs.length - 1].id);
        } else if (newTabs.length === 0) {
          setActiveTabId(null);
        }
        return newTabs;
      });
      delete originalRequestsRef.current[pendingSaveTabId];
      setDeletedTabs((prev) => {
        const next = new Set(prev);
        next.delete(pendingSaveTabId);
        return next;
      });
    } else {
      const serverData = conflictedTabs[pendingSaveTabId];
      if (serverData && tab) {
        if (tab.type === 'example') {
          setOpenTabs((prev) => prev.map((item) => (
            item.id === pendingSaveTabId
              ? { ...item, example: { ...item.example, ...serverData }, dirty: false }
              : item
          )));
          originalRequestsRef.current[pendingSaveTabId] = JSON.stringify({
            name: serverData.name,
            request_data: serverData.request_data,
            response_data: serverData.response_data,
          });
        } else {
          setOpenTabs((prev) => prev.map((item) => (
            item.id === pendingSaveTabId
              ? { ...item, request: { ...item.request, ...serverData }, dirty: false }
              : item
          )));
          originalRequestsRef.current[pendingSaveTabId] = JSON.stringify({
            method: serverData.method,
            url: serverData.url,
            headers: serverData.headers,
            body: serverData.body,
            body_type: serverData.body_type,
            auth_type: serverData.auth_type,
            auth_token: serverData.auth_token,
          });
        }

        setConflictedTabs((prev) => {
          const next = { ...prev };
          delete next[pendingSaveTabId];
          return next;
        });
      }
    }

    setShowConflictModal(false);
    setPendingSaveTabId(null);
  }, [activeTabId, conflictedTabs, deletedTabs, openTabs, originalRequestsRef, pendingSaveTabId, setActiveTabId, setConflictedTabs, setDeletedTabs, setOpenTabs]);

  return {
    showConflictModal,
    setShowConflictModal,
    pendingSaveTabId,
    handleOverwriteConflict,
    handleDiscardChanges,
    handleSaveRequest,
    handleSaveExample,
  };
}
