import { Sun, Moon } from 'lucide-react';

export function ThemeToggle({ theme, onToggle }) {
  return (
    <div className="theme-toggle">
      <button
        className={theme === 'light' ? 'active' : ''}
        onClick={() => onToggle('light')}
        title="Light mode"
      >
        <Sun size={16} />
      </button>
      <button
        className={theme === 'dark' ? 'active' : ''}
        onClick={() => onToggle('dark')}
        title="Dark mode"
      >
        <Moon size={16} />
      </button>
    </div>
  );
}
