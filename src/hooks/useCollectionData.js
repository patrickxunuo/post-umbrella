import { useCallback, useEffect, useState } from 'react';
import * as data from '../data/index.js';

export function useCollectionData({
  user,
  activeWorkspace,
  activeTab,
  selectedRequest,
  selectedExample,
  onCollectionsLoaded,
}) {
  const [collections, setCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [examples, setExamples] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [activeEnvironment, setActiveEnvironment] = useState(null);
  const [currentRootCollectionId, setCurrentRootCollectionId] = useState(null);

  const loadCollections = useCallback(async () => {
    if (!user) return;
    setCollectionsLoading(true);
    try {
      const workspaceId = activeWorkspace?.id || null;
      const nextCollections = await data.getCollections(workspaceId);
      setCollections(nextCollections);
      onCollectionsLoaded?.(nextCollections, workspaceId);
    } catch (err) {
      console.error('Failed to load collections:', err);
    } finally {
      setCollectionsLoading(false);
    }
  }, [activeWorkspace, onCollectionsLoaded, user]);

  const getRootCollectionId = useCallback((collectionId) => {
    if (!collectionId || collections.length === 0) return null;

    let currentId = collectionId;
    let iterations = 0;
    const maxIterations = 100;

    while (iterations < maxIterations) {
      const collection = collections.find((item) => item.id === currentId);
      if (!collection) return null;
      if (!collection.parent_id) return currentId;
      currentId = collection.parent_id;
      iterations += 1;
    }

    return null;
  }, [collections]);

  // Environments are now workspace-scoped (not collection-scoped)
  const loadEnvironments = useCallback(async (workspaceId) => {
    if (!user || !workspaceId) {
      setEnvironments([]);
      setActiveEnvironment(null);
      return;
    }

    try {
      const nextEnvironments = await data.getEnvironments(workspaceId);
      setEnvironments(nextEnvironments);
      const active = nextEnvironments.find((environment) => environment.is_active);
      setActiveEnvironment(active || null);
    } catch (err) {
      console.error('Failed to load environments:', err);
    }
  }, [user]);

  const loadExamples = useCallback(async (requestId) => {
    if (!requestId || !user) {
      setExamples([]);
      return;
    }

    try {
      const nextExamples = await data.getExamples(requestId);
      setExamples(nextExamples);
    } catch (err) {
      console.error('Failed to load examples:', err);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setCollections([]);
      setCollectionsLoading(false);
      setExamples([]);
      setEnvironments([]);
      setActiveEnvironment(null);
      setCurrentRootCollectionId(null);
      return;
    }

    if (activeWorkspace) {
      loadCollections();
      // Environments are now workspace-scoped, load when workspace changes
      loadEnvironments(activeWorkspace.id);
    }
  }, [user, activeWorkspace, loadCollections, loadEnvironments]);

  useEffect(() => {
    loadExamples(selectedRequest?.id);
  }, [selectedRequest?.id, loadExamples]);

  // Track current root collection for realtime updates (legacy compatibility)
  useEffect(() => {
    let collectionId = null;

    if (selectedRequest?.collection_id) {
      collectionId = selectedRequest.collection_id;
    } else if (selectedExample) {
      const parentRequestId = activeTab?.parentRequestId || selectedExample.request_id;
      if (parentRequestId && collections.length > 0) {
        for (const collection of collections) {
          const foundRequest = collection.requests?.find((request) => request.id === parentRequestId);
          if (foundRequest) {
            collectionId = foundRequest.collection_id;
            break;
          }
        }
      }
    }

    if (collectionId && collections.length > 0) {
      const rootId = getRootCollectionId(collectionId);
      if (rootId !== currentRootCollectionId) {
        setCurrentRootCollectionId(rootId);
      }
    } else if (!selectedRequest && !selectedExample) {
      setCurrentRootCollectionId(null);
    }
  }, [
    selectedRequest?.collection_id,
    selectedExample,
    activeTab?.parentRequestId,
    collections,
    getRootCollectionId,
    currentRootCollectionId,
  ]);

  return {
    collections,
    setCollections,
    collectionsLoading,
    examples,
    setExamples,
    environments,
    setEnvironments,
    activeEnvironment,
    setActiveEnvironment,
    currentRootCollectionId,
    setCurrentRootCollectionId,
    loadCollections,
    loadEnvironments,
    loadExamples,
  };
}
