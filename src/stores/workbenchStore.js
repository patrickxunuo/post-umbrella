import { create } from 'zustand';
import * as data from '../data/index.js';

// Helper: create a setter that supports both direct values and functional updates (like useState)
const stateSetter = (key) => (set) => (updater) =>
  set((s) => ({ [key]: typeof updater === 'function' ? updater(s[key]) : updater }));

const useWorkbenchStore = create((set, get) => ({
  // Tab state
  openTabs: JSON.parse(localStorage.getItem('openTabs') || '[]'),
  activeTabId: localStorage.getItem('activeTabId') || null,
  previewTabId: null,
  conflictedTabs: {},
  deletedTabs: new Set(),

  // Pending indicators
  pendingRequestIds: new Set(),
  pendingExampleIds: new Set(),
  pendingExampleListRequestIds: new Set(),
  pendingCollectionIds: new Set(),

  // Sidebar reveal
  revealRequestId: null,
  revealCollectionId: null,

  // Workflows
  workflows: [],

  // Mutable ref-like state (not triggering renders when accessed via getState())
  _originalRequests: {},
  _recentlyModified: new Map(),

  // Setters (all support functional updates)
  setOpenTabs: stateSetter('openTabs')(set),
  setActiveTabId: stateSetter('activeTabId')(set),
  setPreviewTabId: stateSetter('previewTabId')(set),
  setConflictedTabs: stateSetter('conflictedTabs')(set),
  setDeletedTabs: stateSetter('deletedTabs')(set),
  setPendingRequestIds: stateSetter('pendingRequestIds')(set),
  setPendingExampleIds: stateSetter('pendingExampleIds')(set),
  setPendingExampleListRequestIds: stateSetter('pendingExampleListRequestIds')(set),
  setPendingCollectionIds: stateSetter('pendingCollectionIds')(set),
  setRevealRequestId: (v) => set({ revealRequestId: v }),
  setRevealCollectionId: (v) => set({ revealCollectionId: v }),
  setWorkflows: stateSetter('workflows')(set),

  // Recently modified tracking (ref-like, access via getState())
  markAsRecentlyModified: (tabId) => {
    const map = get()._recentlyModified;
    map.set(tabId, Date.now());
    setTimeout(() => map.delete(tabId), 5000);
  },

  wasRecentlyModified: (tabId) => {
    const timestamp = get()._recentlyModified.get(tabId);
    if (!timestamp) return false;
    return Date.now() - timestamp < 5000;
  },

  // Original request ref helpers
  getOriginalRequest: (tabId) => get()._originalRequests[tabId],
  setOriginalRequest: (tabId, value) => {
    get()._originalRequests[tabId] = value;
  },
  deleteOriginalRequest: (tabId) => {
    delete get()._originalRequests[tabId];
  },

  // Tab update operations
  updateTabRequest: (updates) => {
    const { activeTabId, previewTabId, _originalRequests } = get();
    if (!activeTabId) return;

    set((s) => ({
      openTabs: s.openTabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const request = { ...tab.request, ...updates };
        const current = JSON.stringify({
          method: request.method, url: request.url, headers: request.headers,
          body: request.body, body_type: request.body_type, form_data: request.form_data,
          auth_type: request.auth_type, auth_token: request.auth_token,
          pre_script: request.pre_script, post_script: request.post_script,
        });
        const dirty = current !== _originalRequests[tab.id];
        return { ...tab, request, dirty };
      }),
      previewTabId: (() => {
        const tab = s.openTabs.find((t) => t.id === activeTabId);
        if (!tab) return previewTabId;
        const request = { ...tab.request, ...updates };
        const current = JSON.stringify({
          method: request.method, url: request.url, headers: request.headers,
          body: request.body, body_type: request.body_type, form_data: request.form_data,
          auth_type: request.auth_type, auth_token: request.auth_token,
          pre_script: request.pre_script, post_script: request.post_script,
        });
        const dirty = current !== _originalRequests[tab.id];
        return (dirty && previewTabId === tab.id) ? null : previewTabId;
      })(),
    }));
  },

  updateTabExample: (updates) => {
    const { activeTabId, previewTabId, _originalRequests } = get();
    if (!activeTabId) return;

    set((s) => ({
      openTabs: s.openTabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const example = { ...tab.example, ...updates };
        const current = JSON.stringify({
          name: example.name, request_data: example.request_data, response_data: example.response_data,
        });
        const dirty = current !== _originalRequests[tab.id];
        return { ...tab, example, dirty };
      }),
      previewTabId: (() => {
        const tab = s.openTabs.find((t) => t.id === activeTabId);
        if (!tab) return previewTabId;
        const example = { ...tab.example, ...updates };
        const current = JSON.stringify({
          name: example.name, request_data: example.request_data, response_data: example.response_data,
        });
        return (current !== _originalRequests[tab.id] && previewTabId === tab.id) ? null : previewTabId;
      })(),
    }));
  },

  initCollectionTab: (tabId, collectionData) => {
    get()._originalRequests[tabId] = JSON.stringify({
      auth_type: collectionData.auth_type, auth_token: collectionData.auth_token,
      pre_script: collectionData.pre_script, post_script: collectionData.post_script,
    });
    set((s) => ({
      openTabs: s.openTabs.map((tab) =>
        tab.id === tabId ? { ...tab, collection: { ...tab.collection, ...collectionData } } : tab
      ),
    }));
  },

  updateTabCollection: (updates) => {
    const { activeTabId, previewTabId, _originalRequests } = get();
    if (!activeTabId) return;

    set((s) => ({
      openTabs: s.openTabs.map((tab) => {
        if (tab.id !== activeTabId || tab.type !== 'collection') return tab;
        const collection = { ...tab.collection, ...updates };
        const current = JSON.stringify({
          auth_type: collection.auth_type, auth_token: collection.auth_token,
          pre_script: collection.pre_script, post_script: collection.post_script,
        });
        const dirty = current !== _originalRequests[tab.id];
        return { ...tab, collection, dirty };
      }),
      previewTabId: (() => {
        const tab = s.openTabs.find((t) => t.id === activeTabId);
        if (!tab || tab.type !== 'collection') return previewTabId;
        const collection = { ...tab.collection, ...updates };
        const current = JSON.stringify({
          auth_type: collection.auth_type, auth_token: collection.auth_token,
          pre_script: collection.pre_script, post_script: collection.post_script,
        });
        return (current !== _originalRequests[tab.id] && previewTabId === tab.id) ? null : previewTabId;
      })(),
    }));
  },

  updateTabWorkflow: (updates) => {
    const { activeTabId, previewTabId, _originalRequests } = get();
    if (!activeTabId) return;

    set((s) => ({
      openTabs: s.openTabs.map((tab) => {
        if (tab.id !== activeTabId || tab.type !== 'workflow') return tab;
        const workflow = { ...tab.workflow, ...updates };
        const current = JSON.stringify({ name: workflow.name, steps: workflow.steps });
        const dirty = current !== _originalRequests[tab.id];
        return { ...tab, workflow, dirty };
      }),
      previewTabId: (() => {
        const tab = s.openTabs.find((t) => t.id === activeTabId);
        if (!tab || tab.type !== 'workflow') return previewTabId;
        const workflow = { ...tab.workflow, ...updates };
        const current = JSON.stringify({ name: workflow.name, steps: workflow.steps });
        return (current !== _originalRequests[tab.id] && previewTabId === tab.id) ? null : previewTabId;
      })(),
    }));
  },

  updateActiveDetailTab: (tabName) => {
    const { activeTabId } = get();
    if (!activeTabId) return;
    set((s) => ({
      openTabs: s.openTabs.map((tab) => (
        tab.id === activeTabId ? { ...tab, activeDetailTab: tabName } : tab
      )),
    }));
  },

  // Save operations
  handleSaveWorkflow: async () => {
    const { activeTabId, openTabs, _originalRequests } = get();
    if (!activeTabId) return;
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab || tab.type !== 'workflow') return;
    const wf = tab.workflow;
    await data.updateWorkflow(wf.id, { name: wf.name, steps: wf.steps });
    _originalRequests[activeTabId] = JSON.stringify({ name: wf.name, steps: wf.steps });
    set((s) => ({
      openTabs: s.openTabs.map((t) => t.id === activeTabId ? { ...t, dirty: false } : t),
    }));
    get().loadWorkflows();
    return { success: true };
  },

  handleSaveCollection: async () => {
    const { activeTabId, openTabs, _originalRequests } = get();
    if (!activeTabId) return;
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab || tab.type !== 'collection') return;
    const col = tab.collection;
    await data.updateCollection(col.id, {
      auth_type: col.auth_type || 'none', auth_token: col.auth_token || '',
      pre_script: col.pre_script || '', post_script: col.post_script || '',
    });
    _originalRequests[activeTabId] = JSON.stringify({
      auth_type: col.auth_type || 'none', auth_token: col.auth_token || '',
      pre_script: col.pre_script || '', post_script: col.post_script || '',
    });
    set((s) => ({
      openTabs: s.openTabs.map((t) => t.id === activeTabId ? { ...t, dirty: false } : t),
    }));
    return { success: true };
  },

  // Workflow loading
  loadWorkflows: async () => {
    try {
      const wfs = await data.getWorkflows();
      set({ workflows: wfs });
    } catch {
      set({ workflows: [] });
    }
  },

  // Reset on logout / workspace switch
  resetTabs: () => set({
    openTabs: [],
    activeTabId: null,
    previewTabId: null,
    conflictedTabs: {},
    deletedTabs: new Set(),
    workflows: [],
  }),
}));

export default useWorkbenchStore;
