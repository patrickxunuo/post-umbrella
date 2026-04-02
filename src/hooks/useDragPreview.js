import { useRef, useEffect, useCallback } from 'react';

/**
 * Provides a custom drag ghost preview element for HTML5 drag-and-drop.
 * Returns setDragPreview(e, label, color?) to call in onDragStart.
 */
export function useDragPreview() {
  const dragPreviewRef = useRef(null);

  const setDragPreview = useCallback((e, label, color) => {
    let el = dragPreviewRef.current;
    if (!el) {
      el = document.createElement('div');
      el.className = 'sidebar-drag-preview';
      document.body.appendChild(el);
      dragPreviewRef.current = el;
    }
    el.innerHTML = color
      ? `<span style="color:${color};font-weight:700;font-size:10px;margin-right:4px">${label.split(' ')[0] || ''}</span>${label.includes(' ') ? label.slice(label.indexOf(' ') + 1) : label}`
      : label;
    el.style.display = 'block';
    e.dataTransfer.setDragImage(el, 12, 12);
    requestAnimationFrame(() => { if (el) el.style.display = 'none'; });
  }, []);

  useEffect(() => {
    return () => {
      if (dragPreviewRef.current) {
        document.body.removeChild(dragPreviewRef.current);
        dragPreviewRef.current = null;
      }
    };
  }, []);

  return setDragPreview;
}
