import { useState, useEffect } from 'react';
import * as data from '../data/index.js';
import { WindowControls } from './WindowControls';

// Optional email domain restriction from env
const EMAIL_DOMAIN = import.meta.env.VITE_EMAIL_DOMAIN || '';

export function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);

  const useMagicLink = data.supportsMagicLink;

  useEffect(() => {
    const handleAuthError = (e) => {
      setWaitingForBrowser(false);
      setError(e.detail?.message || 'Sign in failed.');
    };
    window.addEventListener('auth:error', handleAuthError);
    return () => window.removeEventListener('auth:error', handleAuthError);
  }, []);

  // Validate email domain if restriction is set
  const isEmailValid = (emailAddr) => {
    if (!EMAIL_DOMAIN) return true;
    return emailAddr.endsWith(EMAIL_DOMAIN);
  };

  // Handle user authentication and activation
  const handleAuthenticatedUser = async (user) => {
    // Verify email domain if restriction is set
    if (EMAIL_DOMAIN && user.email && !user.email.endsWith(EMAIL_DOMAIN)) {
      setError(`Only ${EMAIL_DOMAIN} emails are allowed.`);
      await data.logout();
      return;
    }
    // Activate/bootstrap user (handles first user, pending activation, unauthorized)
    try {
      const result = await data.activateUser();
      console.log('Activation result:', result);
    } catch (e) {
      console.error('Activation error:', e);
      // Check if it's an authorization or disabled error
      if (e.action === 'unauthorized' || e.action === 'disabled' ||
          e.message?.includes('not authorized') || e.message?.includes('disabled')) {
        setError(e.message || 'Your account is not authorized. Please contact an administrator.');
        await data.logout();
        return;
      }
      setError(e.message || 'Failed to finish account activation. Please try again.');
      await data.logout();
      return;
    }
    onLogin(user);
  };

  // Check for existing auth session on mount
  useEffect(() => {
    if (useMagicLink) {
      const checkExistingSession = async () => {
        try {
          const user = await data.checkAuth();
          if (user) {
            await handleAuthenticatedUser(user);
          }
        } catch {
          // Not authenticated, show login form
        }
      };
      checkExistingSession();
    }
  }, [useMagicLink]);

  // Listen for auth state changes (handles async hash token processing)
  useEffect(() => {
    if (!useMagicLink || !data.onAuthStateChange) return;

    const subscription = data.onAuthStateChange(async (event, user) => {
      if (event === 'SIGNED_IN' && user) {
        await handleAuthenticatedUser(user);
      }
    });

    return () => {
      subscription?.unsubscribe?.();
    };
  }, [useMagicLink, onLogin]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validate email domain if restriction is set
    if (!isEmailValid(email)) {
      setError(`Only ${EMAIL_DOMAIN} emails are allowed`);
      setLoading(false);
      return;
    }

    try {
      if (useMagicLink) {
        await data.sendMagicLink(email);
        setMagicLinkSent(true);
      } else {
        const result = await data.login(email, password);
        onLogin(result.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!waitingForBrowser) return;
    const timer = setTimeout(() => {
      setWaitingForBrowser(false);
      setError('Sign in timed out. Please try again.');
    }, 60000);
    return () => clearTimeout(timer);
  }, [waitingForBrowser]);

  if (waitingForBrowser) {
    return (
      <div className="login-container">
        <div className="login-drag-region" data-tauri-drag-region />
        <WindowControls className="login-window-controls" compact />
        <div className="login-box">
          <div className="login-logo login-logo-breathing">
            <img src="/umbrella.svg" alt="Post Umbrella" />
          </div>
          <h1>Waiting for browser <span className="animated-dots"><span>.</span><span>.</span><span>.</span></span></h1>
          <p className="login-subtitle">
            Complete sign in from your browser to continue.
          </p>
          {error && <div className="login-error">{error}</div>}
          <button
            type="button"
            className="btn-login btn-secondary"
            onClick={() => { setWaitingForBrowser(false); setError(''); }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (magicLinkSent) {
    return (
      <div className="login-container">
        <div className="login-drag-region" data-tauri-drag-region />
        <WindowControls className="login-window-controls" compact />
        <div className="login-box">
          <div className="login-logo">
            <img src="/umbrella.svg" alt="Post Umbrella" />
          </div>
          <h1>Check your email</h1>
          <p className="login-subtitle">
            We sent a magic link to <strong>{email}</strong>
          </p>
          <p className="login-hint">
            Click the link in your email to sign in.
          </p>
          <button
            type="button"
            className="btn-login btn-secondary"
            onClick={() => setMagicLinkSent(false)}
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-drag-region" data-tauri-drag-region />
      <WindowControls className="login-window-controls" compact />
      <div className="login-box">
        <div className="login-logo">
          <img src="/umbrella.svg" alt="Post Umbrella" />
        </div>
        <h1>Post Umbrella</h1>
        <p className="login-subtitle">Sign in to continue</p>

        {error && <div className="login-error">{error}</div>}

        {useMagicLink && (
          <>
            <button
              type="button"
              className="btn-login btn-slack"
              onClick={async () => {
                setError('');
                try {
                  await data.signInWithSlack();
                  if ('__TAURI_INTERNALS__' in window) setWaitingForBrowser(true);
                } catch (err) {
                  setError(err.message);
                }
              }}
            >
              <svg width="20" height="20" viewBox="0 0 54 54" xmlns="http://www.w3.org/2000/svg"><path d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386" fill="#36C5F0"/><path d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387" fill="#2EB67D"/><path d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386" fill="#ECB22E"/><path d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.25m14.336-.001v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.249a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.387" fill="#E01E5A"/></svg>
              Sign in with Slack
            </button>

            <div className="login-divider"><span>or</span></div>
          </>
        )}

        <form onSubmit={handleSubmit}>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={EMAIL_DOMAIN ? `you${EMAIL_DOMAIN}` : 'you@example.com'}
              required
            />
          </div>

          {!useMagicLink && (
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
            </div>
          )}

          <button type="submit" className="btn-login" disabled={loading}>
            {loading
              ? (useMagicLink ? 'Sending link...' : 'Signing in...')
              : (useMagicLink ? 'Send Magic Link' : 'Sign In')
            }
          </button>
        </form>

        {EMAIL_DOMAIN && (
          <p className="login-hint">
            Only {EMAIL_DOMAIN} emails are allowed
          </p>
        )}
      </div>
    </div>
  );
}
