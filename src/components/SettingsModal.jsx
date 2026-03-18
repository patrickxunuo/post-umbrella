import { useState, useEffect } from 'react';
import { X, Sun, Moon } from 'lucide-react';
import { Checkbox } from './Checkbox';

export function SettingsModal({ config, onSave, onClose }) {
  const [theme, setTheme] = useState(config.theme || 'light');
  const [skipCloseConfirm, setSkipCloseConfirm] = useState(config.skipCloseConfirm || false);
  const [saving, setSaving] = useState(false);

  const hasChanges = theme !== (config.theme || 'light') || skipCloseConfirm !== (config.skipCloseConfirm || false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ theme, skipCloseConfirm });
      onClose();
    } catch {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body settings-body">
          <div className="settings-section">
            <h3 className="settings-section-title">Appearance</h3>
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-text">Theme</span>
                <span className="settings-label-hint">Choose your preferred color scheme</span>
              </div>
              <div className="settings-theme-picker">
                <button
                  className={`settings-theme-option ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => setTheme('light')}
                >
                  <Sun size={16} />
                  Light
                </button>
                <button
                  className={`settings-theme-option ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => setTheme('dark')}
                >
                  <Moon size={16} />
                  Dark
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Editor</h3>
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-text">Close tab behavior</span>
                <span className="settings-label-hint">When closing a tab with unsaved changes</span>
              </div>
              <label className="settings-toggle">
                <Checkbox
                  checked={skipCloseConfirm}
                  onChange={(e) => setSkipCloseConfirm(e.target.checked)}
                />
                <span className="settings-toggle-label">Discard without asking</span>
              </label>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
