import { useState, useEffect } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten;
    const setup = async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized());
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, []);

  if (!isTauri()) return null;

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().toggleMaximize();
  };

  const handleClose = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().close();
  };

  return (
    <div className="window-controls">
      <button className="window-control-btn" onClick={handleMinimize} title="Minimize">
        <Minus size={14} />
      </button>
      <button className="window-control-btn" onClick={handleMaximize} title={maximized ? 'Restore' : 'Maximize'}>
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button className="window-control-btn window-control-close" onClick={handleClose} title="Close">
        <X size={14} />
      </button>
    </div>
  );
}
