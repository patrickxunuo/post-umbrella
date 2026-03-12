import { useCallback, useEffect, useState } from 'react';
import * as data from '../data/index.js';

export function useAuthSession({ onAfterLogout } = {}) {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const validUser = await data.checkAuth();
        setUser(validUser);
      } catch {
        setUser(null);
      }
      setAuthChecked(true);
    };

    verifyAuth();
  }, []);

  useEffect(() => {
    const handleAuthLogout = () => setUser(null);
    window.addEventListener('auth:logout', handleAuthLogout);
    return () => window.removeEventListener('auth:logout', handleAuthLogout);
  }, []);

  const handleLogin = useCallback((userData) => {
    setUser(userData);
  }, []);

  const handleLogout = useCallback(async () => {
    await data.logout();
    setUser(null);
    onAfterLogout?.();
  }, [onAfterLogout]);

  return {
    user,
    authChecked,
    handleLogin,
    handleLogout,
  };
}
