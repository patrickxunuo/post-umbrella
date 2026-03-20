import { useState } from 'react';
import { X } from 'lucide-react';
import { Checkbox } from './Checkbox';

export function CloseToTrayModal({ onHideToTray, onClose, onCancel }) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Close Window</h2>
          <button className="modal-close" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">Would you like to minimize to the system tray or close the app?</p>
        </div>
        <label className="unsaved-modal-check" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <div className="unsaved-modal-check-content">
            <span className="unsaved-modal-check-label">Remember my choice</span>
            <span className="unsaved-modal-check-hint">You can change this anytime from your Settings.</span>
          </div>
        </label>
        <div className="unsaved-modal-footer">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <div className="unsaved-modal-right">
            <button className="btn-danger" onClick={() => onClose(remember)}>
              Close
            </button>
            <button className="btn-primary" onClick={() => onHideToTray(remember)}>
              Hide to Tray
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
