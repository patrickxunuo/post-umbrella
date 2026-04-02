import { useState, useMemo, useCallback, useEffect } from 'react';
import { useWorkbench } from '../contexts/WorkbenchContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import * as data from '../data/index.js';

export function useCollectionVariables() {
  const { activeTab, selectedRequest, collections, loadEnvironments } = useWorkbench();
  const { activeWorkspace } = useWorkspace();
  const [collectionVariables, setCollectionVariables] = useState([]);

  const activeCollectionId = useMemo(() => {
    if (activeTab?.type === 'collection') return activeTab.collection?.id;
    if (selectedRequest?.collection_id) return selectedRequest.collection_id;
    return null;
  }, [activeTab?.type, activeTab?.collection?.id, selectedRequest?.collection_id]);

  const rootCollectionId = useMemo(() => {
    if (!activeCollectionId || !collections) return null;
    let currentId = activeCollectionId;
    let iterations = 0;
    while (currentId && iterations < 50) {
      const col = collections.find(c => c.id === currentId);
      if (!col) break;
      if (!col.parent_id) return col.id;
      currentId = col.parent_id;
      iterations++;
    }
    return currentId;
  }, [activeCollectionId, collections]);

  const reloadCollectionVariables = useCallback(() => {
    if (!rootCollectionId) return;
    data.getCollectionVariables(rootCollectionId).then(setCollectionVariables).catch(() => setCollectionVariables([]));
  }, [rootCollectionId]);

  useEffect(() => {
    if (!rootCollectionId) { setCollectionVariables([]); return; }
    reloadCollectionVariables();
  }, [rootCollectionId, reloadCollectionVariables]);

  const onEnvironmentUpdate = useCallback(() => {
    if (activeWorkspace?.id) loadEnvironments(activeWorkspace.id);
    reloadCollectionVariables();
  }, [activeWorkspace?.id, loadEnvironments, reloadCollectionVariables]);

  return { collectionVariables, rootCollectionId, reloadCollectionVariables, onEnvironmentUpdate };
}
