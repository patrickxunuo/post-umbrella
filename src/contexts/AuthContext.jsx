import { useEffect } from 'react';
import useAuthStore from '../stores/authStore';

// Initialize auth on first import — runs once
let initialized = false;

export function AuthProvider({ children }) {
  useEffect(() => {
    if (!initialized) {
      initialized = true;
      useAuthStore.getState().initialize();
    }
  }, []);

  return children;
}

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const authChecked = useAuthStore((s) => s.authChecked);
  const handleLogin = useAuthStore((s) => s.handleLogin);
  const handleLogout = useAuthStore((s) => s.handleLogout);
  return { user, authChecked, handleLogin, handleLogout };
}
