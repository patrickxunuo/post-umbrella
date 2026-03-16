import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import {
  createPendingAuth,
  completePendingAuth,
  exchangeCode,
  getRedirectInfo,
  getRegisteredClient,
  registerClient,
} from './store.js';
import { storeSession, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase.js';

const BASE_URL = process.env.MCP_BASE_URL || 'http://localhost:3100';
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:5173';

export const authRouter = Router();

// OAuth 2.1 Protected Resource Metadata (RFC 9728)
authRouter.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
  res.json({
    resource: `${BASE_URL}/mcp`,
    authorization_servers: [BASE_URL],
    scopes_supported: ['read', 'write'],
  });
});

// OAuth 2.1 Authorization Server Metadata
authRouter.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'write'],
  });
});

// OAuth dynamic client registration for public clients like Codex
authRouter.post('/register', (req: Request, res: Response) => {
  const {
    client_name,
    redirect_uris,
    grant_types,
    response_types,
    token_endpoint_auth_method,
    scope,
  } = req.body ?? {};

  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    res.status(400).json({
      error: 'invalid_client_metadata',
      error_description: 'redirect_uris must be a non-empty array',
    });
    return;
  }

  const invalidRedirect = redirect_uris.some((uri) => typeof uri !== 'string' || !uri.startsWith('http'));
  if (invalidRedirect) {
    res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'All redirect_uris must be absolute http or https URLs',
    });
    return;
  }

  if (token_endpoint_auth_method && token_endpoint_auth_method !== 'none') {
    res.status(400).json({
      error: 'invalid_client_metadata',
      error_description: 'Only public clients with token_endpoint_auth_method "none" are supported',
    });
    return;
  }

  const client = registerClient({
    clientName: typeof client_name === 'string' ? client_name : undefined,
    redirectUris: redirect_uris,
    grantTypes: Array.isArray(grant_types) ? grant_types : undefined,
    responseTypes: Array.isArray(response_types) ? response_types : undefined,
    tokenEndpointAuthMethod: 'none',
    scope: typeof scope === 'string' ? scope : undefined,
  });

  res.status(201).json({
    client_id: client.clientId,
    client_id_issued_at: client.createdAt,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    scope: client.scope,
  });
});

// Authorization endpoint — redirects to webapp for auth
authRouter.get('/authorize', (req: Request, res: Response) => {
  const { client_id, code_challenge, code_challenge_method, redirect_uri, state } = req.query;

  if (!code_challenge || !redirect_uri || !state) {
    res.status(400).json({ error: 'Missing required OAuth parameters' });
    return;
  }

  if (code_challenge_method !== 'S256') {
    res.status(400).json({ error: 'Only S256 code challenge method is supported' });
    return;
  }

  if (client_id) {
    const client = getRegisteredClient(client_id as string);
    if (!client) {
      res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
      return;
    }
    if (!client.redirectUris.includes(redirect_uri as string)) {
      res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is not registered for this client' });
      return;
    }
  }

  // Store OAuth params and create session ID
  const sessionId = createPendingAuth({
    clientId: client_id as string | undefined,
    codeChallenge: code_challenge as string,
    redirectUri: redirect_uri as string,
    state: state as string,
  });

  // Redirect to webapp's mcp-auth page (same origin as Supabase session)
  const params = new URLSearchParams({
    session_id: sessionId,
    mcp_base: BASE_URL,
    sb_url: SUPABASE_URL,
    sb_key: SUPABASE_ANON_KEY,
  });
  res.redirect(`${WEBAPP_URL}/mcp-authorize?${params}`);
});

// CORS preflight for cross-origin requests from webapp
authRouter.options('/auth/complete', (_req: Request, res: Response) => {
  res.set({
    'Access-Control-Allow-Origin': WEBAPP_URL,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }).sendStatus(204);
});

// Server-side callback: receives tokens from the callback page JS
authRouter.post('/auth/complete', (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', WEBAPP_URL);
  const { session_id, access_token, refresh_token, expires_at, user_id, email } = req.body;

  if (!session_id || !access_token || !refresh_token || !user_id) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const code = completePendingAuth(session_id, {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: expires_at || Math.floor(Date.now() / 1000) + 3600,
    userId: user_id,
    email: email || '',
  });

  if (!code) {
    res.status(400).json({ error: 'Invalid or expired session' });
    return;
  }

  res.json({ code });
});

// CORS preflight for redirect-info
authRouter.options('/auth/redirect-info', (_req: Request, res: Response) => {
  res.set({
    'Access-Control-Allow-Origin': WEBAPP_URL,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }).sendStatus(204);
});

// Redirect info for callback page
authRouter.get('/auth/redirect-info', (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', WEBAPP_URL);
  const code = req.query.code as string;
  if (!code) { res.status(400).json({ error: 'Missing code' }); return; }
  const info = getRedirectInfo(code);
  if (!info) { res.status(404).json({ error: 'Code not found' }); return; }
  res.json(info);
});

// Token endpoint — exchanges auth code for access token
authRouter.post('/token', (req: Request, res: Response) => {
  const { grant_type, code, code_verifier, redirect_uri, client_id } = req.body;

  if (grant_type !== 'authorization_code') {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }

  if (!code || !code_verifier || !redirect_uri) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
    return;
  }

  if (client_id) {
    const client = getRegisteredClient(client_id as string);
    if (!client) {
      res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
      return;
    }
    if (!client.redirectUris.includes(redirect_uri as string)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri does not match registered client' });
      return;
    }
  }

  const auth = exchangeCode(code, code_verifier, redirect_uri);
  if (!auth) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    return;
  }

  if (auth.clientId && auth.clientId !== client_id) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'client_id does not match authorization code' });
    return;
  }

  // Generate a long-lived MCP token that maps to the Supabase session
  const mcpToken = randomBytes(48).toString('hex');

  storeSession(mcpToken, {
    supabaseRefreshToken: auth.supabaseRefreshToken!,
    cachedAccessToken: auth.supabaseAccessToken!,
    expiresAt: auth.supabaseExpiresAt || Math.floor(Date.now() / 1000) + 3600,
    userId: auth.userId!,
    email: auth.email!,
  });

  res.json({
    access_token: mcpToken,
    token_type: 'Bearer',
    expires_in: 86400 * 30, // 30 days (MCP token lifetime; Supabase refresh handles actual auth)
  });
});

