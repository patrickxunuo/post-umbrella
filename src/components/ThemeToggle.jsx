import { Sun, Moon } from 'lucide-react';

export function ThemeToggle({ theme, onToggle }) {
  const toggle = () => onToggle(theme === 'dark' ? 'light' : 'dark');

  return (
    <div className="theme-toggle" onClick={toggle} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      <span className={`theme-toggle-option ${theme === 'light' ? 'active' : ''}`}>
        <Sun size={16} />
      </span>
      <span className={`theme-toggle-option ${theme === 'dark' ? 'active' : ''}`}>
        <Moon size={16} />
      </span>
    </div>
  );
}
