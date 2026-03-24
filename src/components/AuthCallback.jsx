import { useEffect, useState } from 'react';
import { supabase } from '../data/supabase/client.js';
import { activateUser } from '../data/index.js';

function buildDesktopDeepLink(session) {
  const params = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in || 3600),
    expires_at: String(session.expires_at || Math.floor(Date.now() / 1000) + 3600),
    token_type: 'bearer',
    type: 'magiclink',
  });
  return `postumbrella://auth?${params.toString()}`;
}

export function AuthCallback() {
  const [status, setStatus] = useState('Signing you in');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const params = new URLSearchParams(window.location.search);
  const isDesktopSource = params.get('source') === 'desktop';

  useEffect(() => {
    const errorParam = new URLSearchParams(window.location.search).get('error')
      || new URLSearchParams(window.location.hash.replace('#', '?')).get('error');
    if (errorParam) {
      setError(errorParam === 'access_denied'
        ? 'Sign in was cancelled.'
        : 'Sign in failed. Please try again.');
      return;
    }

    let handled = false;

    const redirectWithSession = async () => {
      if (handled) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return false;
      handled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      unsubscribe.data.subscription.unsubscribe();

      try {
        await activateUser();
      } catch (e) {
        const msg = e.action === 'disabled'
          ? 'Your account has been disabled. Please contact an administrator.'
          : e.action === 'unauthorized'
            ? 'Your account is not authorized. Please contact an administrator to get invited.'
            : 'Sign in failed. Please try again.';
        setError(msg);
        await supabase.auth.signOut();
        return true;
      }

      if (isDesktopSource) {
        setStatus('Opening desktop app');
        window.location.href = buildDesktopDeepLink(session);
        // Show completion state after a short delay
        setTimeout(() => setDone(true), 500);
      } else {
        window.location.replace('/');
      }
      return true;
    };

    // Listen for auth state changes (in case tokens haven't been processed yet)
    const unsubscribe = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        redirectWithSession();
      }
    });

    // Also check immediately — session may already be set by detectSessionInUrl
    redirectWithSession();

    // Poll briefly in case of timing issues
    const interval = setInterval(() => redirectWithSession(), 500);

    // Final fallback
    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        unsubscribe.data.subscription.unsubscribe();
        window.location.replace('/');
      }
    }, 8000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
      unsubscribe.data.subscription.unsubscribe();
    };
  }, [isDesktopSource]);

  return (
    <div className="login-container">
      <div className="login-box">
        <div className={`login-logo${!error && !done ? ' login-logo-breathing' : ''}`}>
          <img src="/umbrella.svg" alt="Post Umbrella" />
        </div>
        {error ? (
          <>
            <h1 style={{ marginBottom: '20px', color: 'var(--accent-danger)' }}>Sign in failed</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{error}</p>
          </>
        ) : done ? (
          <>
            <h1 style={{ marginBottom: '20px' }}>You're signed in!</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              You can close this tab and return to the app.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ marginBottom: '20px' }}>{status} <span className="animated-dots"><span>.</span><span>.</span><span>.</span></span></h1>
          </>
        )}
      </div>
    </div>
  );
}
