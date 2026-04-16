import { create } from 'zustand';

const useModalStore = create((set) => ({
  // Modal visibility
  showEnvEditor: false,
  showImportCurl: false,
  showImportModal: false,
  showSettings: false,
  showAbout: false,
  showCloseModal: false,

  // Tab close modals
  draftSavePending: null,
  tempCloseTabId: null,
  dirtyCloseTabId: null,

  // Setters
  setShowEnvEditor: (v) => set({ showEnvEditor: v }),
  setShowImportCurl: (v) => set({ showImportCurl: v }),
  setShowImportModal: (v) => set({ showImportModal: v }),
  setShowSettings: (v) => set({ showSettings: v }),
  setShowAbout: (v) => set({ showAbout: v }),
  setShowCloseModal: (v) => set({ showCloseModal: v }),
  setDraftSavePending: (v) => set({ draftSavePending: v }),
  setTempCloseTabId: (v) => set({ tempCloseTabId: v }),
  setDirtyCloseTabId: (v) => set({ dirtyCloseTabId: v }),
}));

export default useModalStore;
