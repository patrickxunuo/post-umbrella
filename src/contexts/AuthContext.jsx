import { createContext, useContext } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const value = useAuthSession();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
