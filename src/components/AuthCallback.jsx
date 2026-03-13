import { useState, useEffect } from 'react';

const DEEP_LINK_SCHEME = 'postumbrella';
const DEEP_LINK_TIMEOUT = 2500;

export function AuthCallback() {
  const [showButtons, setShowButtons] = useState(false);
  const [error, setError] = useState('');

  // Use hash captured before Supabase SDK cleared it
  const savedHash = window.__AUTH_CALLBACK_HASH__ || '';

  useEffect(() => {
    if (!savedHash || !savedHash.includes('access_token')) {
      setError('No authentication tokens found. Please request a new magic link.');
      setShowButtons(true);
      return;
    }

    const deepLink = `${DEEP_LINK_SCHEME}://auth?${savedHash}`;

    // Try opening the desktop app via hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = deepLink;
    document.body.appendChild(iframe);

    // Fallback via location after a short delay
    setTimeout(() => {
      window.location.href = deepLink;
    }, 100);

    // After timeout, show manual buttons
    setTimeout(() => {
      setShowButtons(true);
    }, DEEP_LINK_TIMEOUT);

    return () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
  }, [savedHash]);

  const handleOpenApp = () => {
    window.location.href = `${DEEP_LINK_SCHEME}://auth?${savedHash}`;
  };

  const handleContinueWeb = () => {
    // Navigate to root — Supabase SDK already processed the tokens,
    // so the user is authenticated, just needs to load the main app
    window.location.href = '/';
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-logo">
          <img src="/umbrella.svg" alt="Post Umbrella" />
        </div>

        {!showButtons && (
          <>
            <h1>Signing you in...</h1>
            <p className="login-subtitle">Checking for the Post Umbrella desktop app</p>
          </>
        )}

        {showButtons && !error && (
          <>
            <h1>Open in Post Umbrella</h1>
            <p className="login-subtitle">Click below to sign in to the desktop app</p>
            <button className="btn-login" onClick={handleOpenApp}>
              Open Post Umbrella
            </button>
            <button
              className="btn-login btn-secondary"
              onClick={handleContinueWeb}
              style={{ marginTop: '12px' }}
            >
              Continue in browser
            </button>
          </>
        )}

        {error && (
          <>
            <h1>Something went wrong</h1>
            <div className="login-error">{error}</div>
            <a className="btn-login btn-secondary" href="/">Go to Post Umbrella</a>
          </>
        )}

        {!showButtons && (
          <p className="login-hint">Didn't open automatically? Wait a moment...</p>
        )}
      </div>
    </div>
  );
}
