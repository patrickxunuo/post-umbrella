import { create } from 'zustand';

const useConsoleStore = create((set, get) => ({
  logs: [],
  activePanel: null, // 'console' | 'terminal' | null
  panelHeight: parseInt(localStorage.getItem('bottomPanelHeight') || '200', 10),

  addLogs: (requestName, entries) => set((state) => ({
    logs: [
      ...state.logs,
      ...entries.map((entry) => ({
        ...entry,
        requestName,
        timestamp: entry.timestamp || Date.now(),
      })),
    ],
  })),

  clearLogs: () => set({ logs: [] }),

  togglePanel: (panel) => set((state) => ({
    activePanel: state.activePanel === panel ? null : panel,
  })),

  setActivePanel: (panel) => set({ activePanel: panel }),

  setPanelHeight: (height) => {
    localStorage.setItem('bottomPanelHeight', String(height));
    set({ panelHeight: height });
  },
}));

export default useConsoleStore;
