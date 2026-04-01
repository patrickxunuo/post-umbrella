// Auth functions
import { supabase } from './client.js';
import { setCurrentUser, _setCurrentUser, getCurrentUser } from './helpers.js';

// Check if email is allowed to login (calls RPC function that bypasses RLS)
export const checkEmailAllowed = async (email) => {
  const { data, error } = await supabase.rpc('check_email_allowed', {
    check_email: email,
  });

  if (error) {
    // If RPC function doesn't exist yet, allow login (graceful degradation)
    console.warn('check_email_allowed RPC not available:', error.message);
    return { allowed: true, status: null, message: null };
  }

  return data;
};

const getAuthCallbackUrl = () => {
  const base = import.meta.env.VITE_AUTH_CALLBACK_URL || `${window.location.origin}/auth/callback`;
  const isDesktop = '__TAURI_INTERNALS__' in window;
  return isDesktop ? `${base}?source=desktop` : base;
};

// Auth - Magic Link (email only)
export const sendMagicLink = async (email) => {
  // Check if user is allowed to login before sending magic link
  const result = await checkEmailAllowed(email);

  if (!result.allowed) {
    throw new Error(result.message || 'This email is not registered.');
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: getAuthCallbackUrl(),
    },
  });
  if (error) throw new Error(error.message);
  return { message: 'Check your email for the magic link!' };
};

export const signInWithSlack = async () => {
  const isDesktop = '__TAURI_INTERNALS__' in window;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'slack_oidc',
    options: {
      redirectTo: getAuthCallbackUrl(),
      skipBrowserRedirect: isDesktop,
    },
  });
  if (error) throw new Error(error.message);
  if (isDesktop && data?.url) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_url_in_browser', { url: data.url });
  }
};


// Password login (for compatibility - not primary auth method)
export const login = async (email, password) => {
  // Try magic link instead since we're using email-only auth
  throw new Error('Password login not supported. Please use magic link.');
};

export const logout = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
  _setCurrentUser(null);
  setCurrentUser(null);
};

export const getDesktopDeepLink = async (uiState = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const params = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in || 3600),
    expires_at: String(session.expires_at || Math.floor(Date.now() / 1000) + 3600),
    token_type: 'bearer',
    type: 'magiclink',
  });
  if (uiState.tabIds?.length) params.set('_t', uiState.tabIds.join(','));
  if (uiState.activeTabId) params.set('_at', uiState.activeTabId);
  if (uiState.expandedCollections?.length) params.set('_ec', uiState.expandedCollections.join(','));
  if (uiState.expandedRequests?.length) params.set('_er', uiState.expandedRequests.join(','));
  return `postumbrella://auth?${params.toString()}`;
};

// Subscribe to auth state changes (for handling async hash token processing)
export const onAuthStateChange = (callback) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session?.user) {
      const user = { id: session.user.id, email: session.user.email };
      _setCurrentUser(user);
      callback(event, user);
    } else if (event === 'SIGNED_OUT') {
      _setCurrentUser(null);
      callback(event, null);
    }
  });
  return subscription;
};

