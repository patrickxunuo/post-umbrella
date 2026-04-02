import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import useModalStore from '../stores/modalStore';

export function useTauriClose(userConfig) {
  const { user } = useAuth();
  const setShowCloseModal = useModalStore((s) => s.setShowCloseModal);
  const userRef = useRef(null);
  const closeBehaviorRef = useRef(null);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { closeBehaviorRef.current = userConfig.closeBehavior; }, [userConfig.closeBehavior]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let unlisten;
    let cancelled = false;
    import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return;
      listen('close-requested', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        if (!userRef.current) {
          await invoke('close_app');
        } else {
          const behavior = closeBehaviorRef.current;
          if (behavior === 'tray') {
            await invoke('hide_window');
          } else if (behavior === 'close') {
            await invoke('close_app');
          } else {
            setShowCloseModal(true);
          }
        }
      }).then(fn => { if (!cancelled) unlisten = fn; else fn(); });
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [setShowCloseModal]);
}
