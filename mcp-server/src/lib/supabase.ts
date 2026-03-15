import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
}

// Admin client for token operations (uses anon key, not service role)
export const adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Create a Supabase client authenticated as a specific user
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Session store: maps MCP token → Supabase credentials
interface StoredSession {
  supabaseRefreshToken: string;
  cachedAccessToken: string;
  expiresAt: number; // unix seconds
  userId: string;
  email: string;
}

const sessions = new Map<string, StoredSession>();

export function storeSession(mcpToken: string, session: StoredSession) {
  sessions.set(mcpToken, session);
}

export function getStoredSession(mcpToken: string): StoredSession | undefined {
  return sessions.get(mcpToken);
}

export function deleteSession(mcpToken: string) {
  sessions.delete(mcpToken);
}

// Get a valid Supabase client for an MCP token, refreshing if needed
export async function getAuthenticatedClient(mcpToken: string): Promise<{ client: SupabaseClient; userId: string } | null> {
  const stored = getStoredSession(mcpToken);
  if (!stored) return null;

  const now = Math.floor(Date.now() / 1000);

  // If cached access token is still valid (with 60s buffer), use it
  if (stored.expiresAt > now + 60) {
    return { client: createUserClient(stored.cachedAccessToken), userId: stored.userId };
  }

  // Refresh the token
  const { data, error } = await adminClient.auth.refreshSession({
    refresh_token: stored.supabaseRefreshToken,
  });

  if (error || !data.session) {
    sessions.delete(mcpToken);
    return null;
  }

  // Update cached tokens
  stored.cachedAccessToken = data.session.access_token;
  stored.supabaseRefreshToken = data.session.refresh_token;
  stored.expiresAt = data.session.expires_at || now + 3600;

  return { client: createUserClient(stored.cachedAccessToken), userId: stored.userId };
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
