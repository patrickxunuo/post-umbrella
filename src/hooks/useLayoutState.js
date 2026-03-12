import { useCallback, useEffect, useRef, useState } from 'react';

export function useLayoutState() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [sidebarWidth, setSidebarWidth] = useState(() => parseInt(localStorage.getItem('sidebarWidth')) || 280);
  const [requestEditorHeight, setRequestEditorHeight] = useState(() => parseInt(localStorage.getItem('requestEditorHeight')) || 400);

  const isResizing = useRef(false);
  const isResizingVertical = useRef(false);
  const mainContentRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const handleThemeChange = useCallback((nextTheme) => {
    setTheme(nextTheme);
  }, []);

  const startResizing = useCallback(() => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const startResizingVertical = useCallback(() => {
    isResizingVertical.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizing.current) {
        const nextWidth = Math.max(200, Math.min(e.clientX, 500));
        setSidebarWidth(nextWidth);
        localStorage.setItem('sidebarWidth', nextWidth);
      }

      if (isResizingVertical.current && mainContentRef.current) {
        const rect = mainContentRef.current.getBoundingClientRect();
        const tabsBarHeight = 42;
        const minRequestHeight = 300;
        const minResponseHeight = 300;
        const nextHeight = e.clientY - rect.top - tabsBarHeight;
        const clampedHeight = Math.max(minRequestHeight, Math.min(nextHeight, rect.height - minResponseHeight));
        setRequestEditorHeight(clampedHeight);
        localStorage.setItem('requestEditorHeight', clampedHeight);
      }
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      isResizingVertical.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return {
    theme,
    handleThemeChange,
    sidebarWidth,
    requestEditorHeight,
    startResizing,
    startResizingVertical,
    mainContentRef,
  };
}
