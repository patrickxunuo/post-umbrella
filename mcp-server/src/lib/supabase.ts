import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable (required for session persistence)');
}

// Admin client for token operations (uses anon key, not service role)
export const adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Service role client for mcp_sessions table (bypasses RLS)
const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

// In-memory cache for read performance (avoids DB query on every /mcp request)
const sessionCache = new Map<string, { session: StoredSession; cachedAt: number }>();
const CACHE_TTL = 60_000; // 1 minute

export async function storeSession(mcpToken: string, session: StoredSession) {
  const now = Math.floor(Date.now() / 1000);
  await serviceClient.from('mcp_sessions').upsert({
    token: mcpToken,
    user_id: session.userId,
    email: session.email,
    refresh_token: session.supabaseRefreshToken,
    access_token: session.cachedAccessToken,
    expires_at: session.expiresAt,
    created_at: now,
    last_used_at: now,
  });
  sessionCache.set(mcpToken, { session, cachedAt: Date.now() });
}

export async function getStoredSession(mcpToken: string): Promise<StoredSession | undefined> {
  // Check cache first
  const cached = sessionCache.get(mcpToken);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.session;
  }

  const { data } = await serviceClient
    .from('mcp_sessions')
    .select('*')
    .eq('token', mcpToken)
    .single();

  if (!data) {
    sessionCache.delete(mcpToken);
    return undefined;
  }

  const session: StoredSession = {
    supabaseRefreshToken: data.refresh_token,
    cachedAccessToken: data.access_token,
    expiresAt: data.expires_at,
    userId: data.user_id,
    email: data.email,
  };
  sessionCache.set(mcpToken, { session, cachedAt: Date.now() });
  return session;
}

export async function deleteSession(mcpToken: string) {
  sessionCache.delete(mcpToken);
  await serviceClient.from('mcp_sessions').delete().eq('token', mcpToken);
}

// Update session in DB after token refresh
async function updateSessionTokens(mcpToken: string, session: StoredSession) {
  const now = Math.floor(Date.now() / 1000);
  await serviceClient.from('mcp_sessions').update({
    refresh_token: session.supabaseRefreshToken,
    access_token: session.cachedAccessToken,
    expires_at: session.expiresAt,
    last_used_at: now,
  }).eq('token', mcpToken);
  sessionCache.set(mcpToken, { session, cachedAt: Date.now() });
}

// Get a valid Supabase client for an MCP token, refreshing if needed
export async function getAuthenticatedClient(mcpToken: string): Promise<{ client: SupabaseClient; userId: string } | null> {
  const stored = await getStoredSession(mcpToken);
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
    await deleteSession(mcpToken);
    return null;
  }

  // Update cached tokens
  stored.cachedAccessToken = data.session.access_token;
  stored.supabaseRefreshToken = data.session.refresh_token;
  stored.expiresAt = data.session.expires_at || now + 3600;

  // Persist refreshed tokens to DB
  await updateSessionTokens(mcpToken, stored);

  return { client: createUserClient(stored.cachedAccessToken), userId: stored.userId };
}

// Cleanup: delete sessions unused for 30 days (runs every 6 hours)
setInterval(async () => {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;
  await serviceClient.from('mcp_sessions').delete().lt('last_used_at', cutoff);
}, 6 * 3600_000);

export { SUPABASE_URL, SUPABASE_ANON_KEY };
