import { useState, useEffect, useRef, useCallback } from 'react';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function useVersionCheck(intervalMs = 60000) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [tauriUpdate, setTauriUpdate] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef(null);

  // Web version check
  useEffect(() => {
    if (isTauri()) return;

    const clientVersion = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : null;
    if (!clientVersion || clientVersion === 'unknown') return;

    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`);
        if (!res.ok) return;
        const { version } = await res.json();
        if (version && version !== clientVersion) {
          setUpdateAvailable(true);
        }
      } catch {
        // Server unreachable — ignore
      }
    };

    check();
    timerRef.current = setInterval(check, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [intervalMs]);

  // Tauri updater check
  const checkTauri = useCallback(async () => {
    if (!isTauri()) return;
    setChecking(true);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        setTauriUpdate(update);
        setUpdateAvailable(true);
      }
    } catch {
      // Updater check failed — ignore
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    checkTauri();
    timerRef.current = setInterval(checkTauri, 5 * 60 * 1000);
    return () => clearInterval(timerRef.current);
  }, [checkTauri]);

  const installUpdate = useCallback(async () => {
    if (!tauriUpdate) return;
    setDownloading(true);
    setDownloadProgress(0);

    try {
      let totalSize = 0;
      let downloaded = 0;

      await tauriUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalSize = event.data.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (totalSize > 0) {
            setDownloadProgress(Math.round((downloaded / totalSize) * 100));
          }
        } else if (event.event === 'Finished') {
          setDownloadProgress(100);
        }
      });

      // Relaunch after install
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      setDownloading(false);
      setDownloadProgress(0);
    }
  }, [tauriUpdate]);

  return {
    updateAvailable,
    tauriUpdate,
    downloading,
    downloadProgress,
    installUpdate,
    checkForUpdate: checkTauri,
    checking,
    isTauri: isTauri(),
  };
}
