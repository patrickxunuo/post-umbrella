import { randomBytes, createHash } from 'crypto';

// Temporary store for OAuth authorization codes
interface PendingAuth {
  codeChallenge: string;
  redirectUri: string;
  state: string;
  expiresAt: number;
  clientId?: string;
  // Set after user authenticates
  supabaseAccessToken?: string;
  supabaseRefreshToken?: string;
  supabaseExpiresAt?: number;
  userId?: string;
  email?: string;
}

interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  scope?: string;
  createdAt: number;
}

// auth_session_id → pending auth params (before user authenticates)
const pendingAuths = new Map<string, PendingAuth>();

// auth_code → completed auth (after user authenticates, before token exchange)
const authCodes = new Map<string, PendingAuth>();

// client_id → registered OAuth client metadata
const registeredClients = new Map<string, RegisteredClient>();

export function createPendingAuth(params: {
  codeChallenge: string;
  redirectUri: string;
  state: string;
  clientId?: string;
}): string {
  const sessionId = randomBytes(32).toString('hex');
  pendingAuths.set(sessionId, {
    ...params,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
  return sessionId;
}

export function getPendingAuth(sessionId: string): PendingAuth | undefined {
  const pending = pendingAuths.get(sessionId);
  if (!pending) return undefined;
  if (Date.now() > pending.expiresAt) {
    pendingAuths.delete(sessionId);
    return undefined;
  }
  return pending;
}

export function completePendingAuth(sessionId: string, supabaseData: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
}): string | null {
  const pending = pendingAuths.get(sessionId);
  if (!pending) return null;

  pendingAuths.delete(sessionId);

  const code = randomBytes(32).toString('hex');
  authCodes.set(code, {
    ...pending,
    supabaseAccessToken: supabaseData.accessToken,
    supabaseRefreshToken: supabaseData.refreshToken,
    supabaseExpiresAt: supabaseData.expiresAt,
    userId: supabaseData.userId,
    email: supabaseData.email,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes to exchange
  });

  return code;
}

export function exchangeCode(code: string, codeVerifier: string, redirectUri: string): PendingAuth | null {
  const auth = authCodes.get(code);
  if (!auth) return null;

  authCodes.delete(code);

  if (Date.now() > auth.expiresAt) return null;
  if (auth.redirectUri !== redirectUri) return null;

  // Verify PKCE: SHA256(code_verifier) must equal stored code_challenge
  const challenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  if (challenge !== auth.codeChallenge) return null;

  return auth;
}

export function registerClient(params: {
  clientName?: string;
  redirectUris: string[];
  grantTypes?: string[];
  responseTypes?: string[];
  tokenEndpointAuthMethod?: string;
  scope?: string;
}): RegisteredClient {
  const clientId = randomBytes(24).toString('hex');
  const client: RegisteredClient = {
    clientId,
    clientName: params.clientName || 'Unnamed client',
    redirectUris: params.redirectUris,
    grantTypes: params.grantTypes || ['authorization_code'],
    responseTypes: params.responseTypes || ['code'],
    tokenEndpointAuthMethod: params.tokenEndpointAuthMethod || 'none',
    scope: params.scope,
    createdAt: Math.floor(Date.now() / 1000),
  };
  registeredClients.set(clientId, client);
  return client;
}

export function getRegisteredClient(clientId: string): RegisteredClient | undefined {
  return registeredClients.get(clientId);
}

// Get redirect info for a code (without consuming it)
export function getRedirectInfo(code: string): { redirect_uri: string; state: string } | null {
  const auth = authCodes.get(code);
  if (!auth) return null;
  return { redirect_uri: auth.redirectUri, state: auth.state };
}

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingAuths) {
    if (now > v.expiresAt) pendingAuths.delete(k);
  }
  for (const [k, v] of authCodes) {
    if (now > v.expiresAt) authCodes.delete(k);
  }
}, 60_000);
