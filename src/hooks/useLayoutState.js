import { useCallback, useEffect, useRef, useState } from 'react';

export function useLayoutState() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [sidebarWidth, setSidebarWidth] = useState(() => parseInt(localStorage.getItem('sidebarWidth')) || 280);
  const [requestEditorHeight, setRequestEditorHeight] = useState(() => parseInt(localStorage.getItem('requestEditorHeight')) || 400);
  const [showCurlPanel, setShowCurlPanel] = useState(false);
  const [curlPanelWidth, setCurlPanelWidth] = useState(() => parseInt(localStorage.getItem('curlPanelWidth')) || 420);

  const isResizing = useRef(false);
  const isResizingVertical = useRef(false);
  const isResizingCurl = useRef(false);
  const mainContentRef = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    // Suppress transitions for one paint cycle so theme-token changes (bg,
    // text, border colors) snap together instead of each transition-enabled
    // element fading independently over ~100ms — which looks like a blink.
    // Matching CSS rule: `html.theme-switching, html.theme-switching *` in App.css.
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    // Force a synchronous reflow so the class + attribute land in the same
    // paint, then release on the next frame after the themed state is committed.
    void root.offsetWidth;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        root.classList.remove('theme-switching');
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
      root.classList.remove('theme-switching');
    };
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

  const startResizingCurl = useCallback(() => {
    isResizingCurl.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const toggleCurlPanel = useCallback(() => {
    setShowCurlPanel(prev => !prev);
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

      if (isResizingCurl.current) {
        const nextWidth = Math.max(280, Math.min(window.innerWidth - e.clientX, 700));
        setCurlPanelWidth(nextWidth);
        localStorage.setItem('curlPanelWidth', nextWidth);
      }
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      isResizingVertical.current = false;
      isResizingCurl.current = false;
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
    showCurlPanel,
    curlPanelWidth,
    startResizingCurl,
    toggleCurlPanel,
  };
}
