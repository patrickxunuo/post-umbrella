import { useState, useEffect } from 'react';
import * as data from '../data/index.js';

// Optional email domain restriction from env
const EMAIL_DOMAIN = import.meta.env.VITE_EMAIL_DOMAIN || '';

export function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const useMagicLink = data.supportsMagicLink;

  // Validate email domain if restriction is set
  const isEmailValid = (emailAddr) => {
    if (!EMAIL_DOMAIN) return true;
    return emailAddr.endsWith(EMAIL_DOMAIN);
  };

  // Check for auth callback (Supabase magic link redirect)
  useEffect(() => {
    if (useMagicLink) {
      const checkAuth = async () => {
        try {
          const user = await data.checkAuth();
          if (user) {
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
              // Other errors - might be network issues, proceed anyway
            }
            onLogin(user);
          }
        } catch (e) {
          // Not authenticated, show login form
        }
      };
      checkAuth();
    }
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

  if (magicLinkSent) {
    return (
      <div className="login-container">
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
      <div className="login-box">
        <div className="login-logo">
          <img src="/umbrella.svg" alt="Post Umbrella" />
        </div>
        <h1>Post Umbrella</h1>
        <p className="login-subtitle">Sign in to continue</p>

        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

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
