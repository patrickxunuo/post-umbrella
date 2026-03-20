import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export function AboutModal({ onClose, updateAvailable, tauriUpdate, downloading, downloadProgress, installUpdate }) {
  const [appVersion, setAppVersion] = useState(null);

  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/app').then(({ getVersion }) => {
        getVersion().then(setAppVersion);
      }).catch(() => {});
    }
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content about-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>
          <X size={16} />
        </button>
        <div className="about-modal-body">
          <img src="/umbrella.svg" alt="Post Umbrella" className="about-logo" />
          <h2 className="about-title">Post Umbrella</h2>
          {appVersion && (
            <span className="about-version">v{appVersion}</span>
          )}
          <p className="about-description">A self-hosted, collaborative API testing tool.</p>
          <div className="about-update-status">
            {updateAvailable && tauriUpdate ? (
              downloading ? (
                <div className="about-updating">
                  <div className="about-progress-bar">
                    <div className="about-progress-fill" style={{ width: `${downloadProgress}%` }} />
                  </div>
                  <span className="about-progress-text">Downloading... {downloadProgress}%</span>
                </div>
              ) : (
                <button className="btn-update" onClick={installUpdate}>
                  Update to v{tauriUpdate.version}
                </button>
              )
            ) : (
              <span className="about-up-to-date">Up to date</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
