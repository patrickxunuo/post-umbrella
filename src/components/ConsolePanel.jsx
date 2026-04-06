import { useEffect, useRef } from 'react';
import { Trash2, X } from 'lucide-react';
import useConsoleStore from '../stores/consoleStore';

export function ConsolePanel() {
  const logs = useConsoleStore((s) => s.logs);
  const clearLogs = useConsoleStore((s) => s.clearLogs);
  const setActivePanel = useConsoleStore((s) => s.setActivePanel);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="console-panel" data-testid="console-panel">
      <div className="console-panel-header">
        <span className="console-panel-title">Console</span>
        <div className="console-panel-actions">
          <button
            className="btn-icon small panel-icon-btn"
            onClick={clearLogs}
            title="Clear console"
            data-testid="console-clear"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="btn-icon small panel-icon-btn"
            onClick={() => setActivePanel(null)}
            title="Close panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="console-panel-body" ref={scrollRef}>
        {logs.length > 0 ? (
          logs.map((log, i) => (
            <div key={i} className={`console-line console-${log.type}`}>
              <div className="console-line-meta">
                <span className="console-time">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className="console-request-name">{log.requestName}</span>
                <span className="console-source">{log.source}</span>
              </div>
              <span className="console-message">{log.message}</span>
            </div>
          ))
        ) : (
          <div className="console-empty">No console output</div>
        )}
      </div>
    </div>
  );
}
