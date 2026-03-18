import { useState } from 'react';
import { X } from 'lucide-react';
import { Checkbox } from './Checkbox';

export function UnsavedChangesModal({ onDontSave, onCancel, onSave, showRemember = false }) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Unsaved Changes</h2>
          <button className="modal-close" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">This request has unsaved changes. What would you like to do?</p>
        </div>
        {showRemember && (
          <label className="unsaved-modal-check" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <div className="unsaved-modal-check-content">
              <span className="unsaved-modal-check-label">Always discard unsaved changes when closing a tab</span>
              <span className="unsaved-modal-check-hint">You'll no longer be prompted to save changes when closing a tab. You can change this anytime from your Settings.</span>
            </div>
          </label>
        )}
        <div className="unsaved-modal-footer">
          <button className="btn-danger" onClick={() => onDontSave(remember)}>
            Don't Save
          </button>
          <div className="unsaved-modal-right">
            <button className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn-primary" onClick={onSave}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
