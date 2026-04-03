import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Plus, RotateCcw } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import useConsoleStore from '../stores/consoleStore';
import '@xterm/xterm/css/xterm.css';

let nextId = 1;

function getTermTheme() {
  const styles = getComputedStyle(document.documentElement);
  const v = (name, fb) => styles.getPropertyValue(name).trim() || fb;
  return {
    background: v('--bg-secondary', '#1e1e1e'),
    foreground: v('--text-primary', '#d4d4d4'),
    cursor: v('--accent-primary', '#3b82f6'),
    cursorAccent: v('--bg-secondary', '#1e1e1e'),
    selectionBackground: 'rgba(59, 130, 246, 0.25)',
    black: '#1e1e1e',
    red: v('--accent-danger', '#ef4444'),
    green: v('--accent-success', '#10b981'),
    yellow: v('--accent-warning', '#f59e0b'),
    blue: v('--accent-primary', '#3b82f6'),
    magenta: '#a78bfa',
    cyan: '#22d3ee',
    white: v('--text-primary', '#d4d4d4'),
    brightBlack: v('--text-tertiary', '#64748b'),
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#67e8f9',
    brightWhite: '#f8fafc',
  };
}

function getShellInfo() {
  const isWin = navigator.platform?.startsWith('Win');
  return {
    shell: isWin ? 'powershell.exe' : '/bin/bash',
    cwd: isWin ? (process.env?.USERPROFILE || 'C:\\Users') : (process.env?.HOME || '/'),
  };
}

function TerminalInstance({ session, isActive, onExited }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const ptyRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      theme: getTermTheme(),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const { shell, cwd } = getShellInfo();
    import('tauri-pty').then(({ spawn }) => {
      const pty = spawn(shell, [], { cols: term.cols, rows: term.rows, cwd });
      ptyRef.current = pty;

      pty.onData((data) => term.write(data));
      term.onData((data) => pty.write(data));
      pty.onExit(({ exitCode }) => {
        term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
        ptyRef.current = null;
        onExited?.(session.id);
      });
    }).catch((err) => {
      term.write(`\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ptyRef.current) ptyRef.current.resize(term.cols, term.rows);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (ptyRef.current) { ptyRef.current.kill(); ptyRef.current = null; }
      term.dispose();
    };
  }, [session.key]); // re-mount on restart (key changes)

  // Refit and focus when becoming active
  useEffect(() => {
    if (isActive) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        termRef.current?.focus();
      }, 50);
    }
  }, [isActive]);

  // Sync theme on data-theme attribute change
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (termRef.current) termRef.current.options.theme = getTermTheme();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="terminal-instance"
      ref={containerRef}
      style={{ display: isActive ? 'flex' : 'none', flex: 1 }}
    />
  );
}

export function TerminalPanel() {
  const [sessions, setSessions] = useState(() => [{ id: nextId++, label: 'Terminal 1', key: 0 }]);
  const [activeSessionId, setActiveSessionId] = useState(1);

  const addSession = useCallback(() => {
    const id = nextId++;
    setSessions(prev => [...prev, { id, label: `Terminal ${id}`, key: 0 }]);
    setActiveSessionId(id);
  }, []);

  const removeSession = useCallback((id) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        // Last terminal closed — close the panel
        useConsoleStore.getState().setActivePanel(null);
        return prev;
      }
      if (activeSessionId === id) {
        setActiveSessionId(next[next.length - 1].id);
      }
      return next;
    });
  }, [activeSessionId]);

  const restartSession = useCallback((id) => {
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, key: s.key + 1 } : s
    ));
  }, []);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="terminal-panel" data-testid="terminal-panel">
      <div className="terminal-panel-header">
        <div className="terminal-tabs">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`terminal-tab ${s.id === activeSessionId ? 'active' : ''}`}
              onClick={() => setActiveSessionId(s.id)}
            >
              <span className="terminal-tab-label">{s.label}</span>
              <button
                className="terminal-tab-close"
                onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                title="Close terminal"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button className="btn-icon small" onClick={addSession} title="New terminal">
            <Plus size={14} />
          </button>
        </div>
        <div className="terminal-panel-actions">
          {activeSession && (
            <button
              className="btn-icon small"
              onClick={() => restartSession(activeSessionId)}
              title="Restart terminal"
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            className="btn-icon small"
            onClick={() => useConsoleStore.getState().setActivePanel(null)}
            title="Close panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="terminal-panel-body">
        {sessions.map(s => (
          <TerminalInstance
            key={`${s.id}-${s.key}`}
            session={s}
            isActive={s.id === activeSessionId}
            onExited={() => {}}
          />
        ))}
      </div>
    </div>
  );
}
