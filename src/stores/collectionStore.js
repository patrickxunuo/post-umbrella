import { create } from 'zustand';
import * as data from '../data/index.js';

const stateSetter = (key) => (set) => (updater) =>
  set((s) => ({ [key]: typeof updater === 'function' ? updater(s[key]) : updater }));

const useCollectionStore = create((set, get) => ({
  collections: [],
  collectionsLoading: false,
  examples: [],
  environments: [],
  activeEnvironment: null,
  currentRootCollectionId: null,

  setCollections: stateSetter('collections')(set),
  setExamples: stateSetter('examples')(set),
  setEnvironments: stateSetter('environments')(set),
  setActiveEnvironment: stateSetter('activeEnvironment')(set),
  setCurrentRootCollectionId: (v) => set({ currentRootCollectionId: v }),

  loadCollections: async (user, activeWorkspace, onCollectionsLoaded) => {
    if (!user) return;
    set({ collectionsLoading: true });
    try {
      const workspaceId = activeWorkspace?.id || null;
      const nextCollections = await data.getCollections(workspaceId);
      set({ collections: nextCollections });
      onCollectionsLoaded?.(nextCollections, workspaceId);
    } catch (err) {
      console.error('Failed to load collections:', err);
    } finally {
      set({ collectionsLoading: false });
    }
  },

  loadEnvironments: async (user, workspaceId) => {
    if (!user || !workspaceId) {
      set({ environments: [], activeEnvironment: null });
      return;
    }
    try {
      const nextEnvironments = await data.getEnvironments(workspaceId);
      set({ environments: nextEnvironments });
      const active = nextEnvironments.find((env) => env.is_active);
      set({ activeEnvironment: active || null });
    } catch (err) {
      console.error('Failed to load environments:', err);
    }
  },

  loadExamples: async (user, requestId) => {
    if (!requestId || !user) {
      set({ examples: [] });
      return;
    }
    try {
      const nextExamples = await data.getExamples(requestId);
      set({ examples: nextExamples });
    } catch (err) {
      console.error('Failed to load examples:', err);
    }
  },

  getRootCollectionId: (collectionId) => {
    const { collections } = get();
    if (!collectionId || collections.length === 0) return null;
    let currentId = collectionId;
    let iterations = 0;
    while (iterations < 100) {
      const collection = collections.find((item) => item.id === currentId);
      if (!collection) return null;
      if (!collection.parent_id) return currentId;
      currentId = collection.parent_id;
      iterations += 1;
    }
    return null;
  },

  reset: () => set({
    collections: [],
    collectionsLoading: false,
    examples: [],
    environments: [],
    activeEnvironment: null,
    currentRootCollectionId: null,
  }),
}));

export default useCollectionStore;
