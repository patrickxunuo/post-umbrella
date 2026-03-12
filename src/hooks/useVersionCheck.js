import { useState, useEffect, useRef } from 'react';

export function useVersionCheck(intervalMs = 60000) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
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

  return { updateAvailable };
}
