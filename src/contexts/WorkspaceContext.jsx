import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAdminWorkspaceState } from '../hooks/useAdminWorkspaceState';
import { useAuth } from './AuthContext';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({
  children,
  prompt,
  toast,
}) {
  const { user } = useAuth();
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [pendingSharedLink, setPendingSharedLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const requestId = params.get('request_id');
    const exampleId = params.get('example_id');
    if (requestId) return { type: 'request', id: requestId };
    if (exampleId) return { type: 'example', id: exampleId };
    return null;
  });

  const workspaceState = useAdminWorkspaceState({
    user,
    activeWorkspace,
    setActiveWorkspace,
    prompt,
    toast,
  });

  const consumePendingSharedLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('request_id');
    url.searchParams.delete('example_id');
    const search = url.searchParams.toString();
    window.history.replaceState({}, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
    setPendingSharedLink(null);
  }, []);

  const value = useMemo(() => ({
    activeWorkspace,
    setActiveWorkspace,
    pendingSharedLink,
    consumePendingSharedLink,
    ...workspaceState,
  }), [activeWorkspace, consumePendingSharedLink, pendingSharedLink, workspaceState]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
