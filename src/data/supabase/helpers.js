// Shared helpers, state, and utilities for supabase data modules
import { supabase } from './client.js';

// Batch large .in() queries to avoid URL length limits
export const BATCH_SIZE = 100;
export const batchedIn = async (table, column, ids, select = '*', extraFilters) => {
  if (ids.length === 0) return [];
  const results = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    let query = supabase.from(table).select(select).in(column, ids.slice(i, i + BATCH_SIZE));
    if (extraFilters) query = extraFilters(query);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (data) results.push(...data);
  }
  return results;
};

// Shared mutable auth state
let currentUser = null;

export const getCurrentUser = () => currentUser;

export const setCurrentUser = (user) => {
  currentUser = user;
  if (user) {
    localStorage.setItem('auth_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('auth_user');
  }
};

export const setAuthToken = (token) => {
  if (!token) currentUser = null;
};

// Internal setter (no localStorage side effect) for checkAuth
export const _setCurrentUser = (user) => { currentUser = user; };

// Initialize user from Supabase session
const initUser = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = { id: session.user.id, email: session.user.email };
  }
};
initUser();

// Check auth + refresh tokens — used by most CRUD functions
export const checkAuth = async () => {
  if (window.__DEEP_LINK_AUTH__) {
    const { access_token, refresh_token } = window.__DEEP_LINK_AUTH__;
    delete window.__DEEP_LINK_AUTH__;
    if (access_token && refresh_token) {
      let { data: { session }, error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error || !session) {
        const refreshResult = await supabase.auth.refreshSession({ refresh_token });
        session = refreshResult.data?.session;
        error = refreshResult.error;
      }
      if (error || !session?.user) {
        const msg = error?.message || 'Failed to authenticate from deep link';
        window.__DEEP_LINK_AUTH_ERROR__ = msg;
        throw new Error(msg);
      }
      currentUser = { id: session.user.id, email: session.user.email };
      return currentUser;
    }
    throw new Error('Failed to authenticate from deep link');
  }

  let { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!session) throw new Error('Not authenticated');

  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  if (Date.now() > expiresAt - 60000) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      await supabase.auth.signOut();
      throw new Error('Session expired. Please log in again.');
    }
    session = refreshData.session;
  }

  currentUser = { id: session.user.id, email: session.user.email };
  return currentUser;
};
