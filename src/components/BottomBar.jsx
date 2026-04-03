import { Terminal, ScrollText } from 'lucide-react';
import useConsoleStore from '../stores/consoleStore';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function BottomBar() {
  const activePanel = useConsoleStore((s) => s.activePanel);
  const togglePanel = useConsoleStore((s) => s.togglePanel);
  const setActivePanel = useConsoleStore((s) => s.setActivePanel);
  const logs = useConsoleStore((s) => s.logs);
  const hasErrors = logs.some((l) => l.type === 'error');

  return (
    <div className="bottom-bar" data-testid="bottom-bar">
      <div className="bottom-bar-left">
        <button
          className={`bottom-bar-btn ${activePanel === 'console' ? 'active' : ''} ${hasErrors ? 'has-errors' : ''}`}
          onClick={() => togglePanel('console')}
          title="Toggle Console"
        >
          <ScrollText size={14} />
          <span>Console</span>
          {logs.length > 0 && (
            <span className={`bottom-bar-badge ${hasErrors ? 'error' : ''}`}>
              {logs.length}
            </span>
          )}
        </button>
        {isTauri() && (
          <button
            className={`bottom-bar-btn ${activePanel === 'terminal' ? 'active' : ''}`}
            onClick={() => {
              // If already on terminal, just ensure focus; otherwise open it
              if (activePanel === 'terminal') return;
              setActivePanel('terminal');
            }}
            title="Open Terminal"
            data-testid="terminal-btn"
          >
            <Terminal size={14} />
            <span>Terminal</span>
          </button>
        )}
      </div>
    </div>
  );
}
