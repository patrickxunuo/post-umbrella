import { create } from 'zustand';
import * as data from '../data/index.js';

const useAuthStore = create((set, get) => ({
  user: null,
  authChecked: false,

  setUser: (user) => set({ user }),

  initialize: async () => {
    try {
      const validUser = await data.checkAuth();
      await data.activateUser();
      set({ user: validUser, authChecked: true });
    } catch {
      set({ user: null, authChecked: true });
    }

    // Listen for Supabase auth state changes
    if (data.onAuthStateChange) {
      data.onAuthStateChange((event, userData) => {
        if (event === 'SIGNED_OUT') {
          set({ user: null });
        } else if (userData) {
          data.activateUser().then(() => {
            const prev = get().user;
            if (prev?.id !== userData?.id) {
              set({ user: userData });
            }
          }).catch((e) => {
            const message = e.action === 'disabled'
              ? 'Your account has been disabled. Please contact an administrator.'
              : e.action === 'unauthorized'
                ? 'Your account is not authorized. Please contact an administrator to get invited.'
                : 'Sign in failed. Please try again.';
            window.dispatchEvent(new CustomEvent('auth:error', { detail: { message } }));
            data.logout();
            set({ user: null });
          });
        }
      });
    }

    // Listen for logout events from other parts of the app
    window.addEventListener('auth:logout', () => set({ user: null }));
  },

  handleLogin: (userData) => set({ user: userData }),

  handleLogout: async () => {
    await data.logout();
    set({ user: null });
  },
}));

export default useAuthStore;
