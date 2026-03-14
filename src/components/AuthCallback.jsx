import { useEffect } from 'react';
import { supabase } from '../data/supabase/client.js';

export function AuthCallback() {
  useEffect(() => {
    // Wait for Supabase to process the hash tokens (detectSessionInUrl),
    // then redirect to root with a valid session.
    const unsubscribe = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        unsubscribe.data.subscription.unsubscribe();
        window.location.replace('/');
      }
    });

    // Fallback: if no auth event fires within 5s, redirect anyway
    const timeout = setTimeout(() => {
      unsubscribe.data.subscription.unsubscribe();
      window.location.replace('/');
    }, 5000);

    return () => {
      clearTimeout(timeout);
      unsubscribe.data.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-logo">
          <img src="/umbrella.svg" alt="Post Umbrella" />
        </div>
        <h1>Signing you in...</h1>
        <div className="loading-spinner" />
      </div>
    </div>
  );
}
