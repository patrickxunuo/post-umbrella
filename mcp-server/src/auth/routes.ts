import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import {
  createPendingAuth,
  completePendingAuth,
  exchangeCode,
  getPendingAuth,
  getRedirectInfo,
  getRegisteredClient,
  registerClient,
} from './store.js';
import { storeSession, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase.js';

const BASE_URL = process.env.MCP_BASE_URL || 'http://localhost:3100';

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

// Authorization endpoint — serves login page
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

  // Serve login page with session ID and Supabase config
  res.send(loginPage(sessionId));
});

// Supabase auth callback — receives tokens after login
authRouter.get('/auth/callback', (req: Request, res: Response) => {
  // This page handles both:
  // 1. Supabase OAuth redirect (tokens in hash fragment)
  // 2. Magic link click (tokens in hash fragment)
  // The page JS extracts tokens and completes the auth flow
  res.send(callbackPage());
});

// Server-side callback: receives tokens from the callback page JS
authRouter.post('/auth/complete', (req: Request, res: Response) => {
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

// Redirect info for callback page
authRouter.get('/auth/redirect-info', (req: Request, res: Response) => {
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

function loginPage(sessionId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Post Umbrella</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      color-scheme: light;
      --bg: linear-gradient(180deg, #eef4ff 0%, #f8fbff 45%, #ffffff 100%);
      --panel: rgba(255, 255, 255, 0.92);
      --panel-border: rgba(148, 163, 184, 0.22);
      --text: #14213d;
      --muted: #64748b;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --error-bg: #fff1f2;
      --error-text: #be123c;
      --error-border: #fecdd3;
      --success-bg: #f0fdf4;
      --success-text: #166534;
      --success-border: #bbf7d0;
      --shadow: 0 20px 60px rgba(37, 99, 235, 0.12);
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .container {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 40px 36px;
      max-width: 420px;
      width: 100%;
      backdrop-filter: blur(18px);
    }
    .logo {
      width: 64px;
      height: 64px;
      border-radius: 18px;
      background: linear-gradient(135deg, #ffffff 0%, #dbeafe 100%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 30px rgba(37, 99, 235, 0.16);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .logo img {
      width: 34px;
      height: 34px;
    }
    h1 { font-size: 30px; font-weight: 700; margin-bottom: 8px; text-align: center; letter-spacing: -0.03em; }
    .subtitle { color: var(--muted); font-size: 15px; margin-bottom: 28px; text-align: center; line-height: 1.5; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 8px; font-weight: 600; }
    input {
      width: 100%;
      padding: 13px 14px;
      background: rgba(255,255,255,0.92);
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 14px;
      color: var(--text);
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    input:hover { background: #fff; }
    input:focus {
      border-color: rgba(37, 99, 235, 0.7);
      box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
      background: #fff;
    }
    button {
      width: 100%;
      padding: 13px 16px;
      border: none;
      border-radius: 14px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
    }
    button:hover { transform: translateY(-1px); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary {
      background: linear-gradient(135deg, var(--primary) 0%, #3b82f6 100%);
      color: white;
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.22);
    }
    .btn-primary:hover { background: linear-gradient(135deg, var(--primary-hover) 0%, var(--primary) 100%); }
    .message {
      text-align: center; padding: 12px; border-radius: 14px; font-size: 14px;
      margin-top: 16px;
      border: 1px solid transparent;
    }
    .message.success { background: var(--success-bg); color: var(--success-text); border-color: var(--success-border); }
    .message.error { background: var(--error-bg); color: var(--error-text); border-color: var(--error-border); }
    .hint {
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
      line-height: 1.5;
    }
    .success-view { display: none; text-align: center; }
    .success-view h2 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 12px;
      letter-spacing: -0.02em;
    }
    .success-view p {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 10px;
    }
    .success-view strong { color: var(--text); }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="/umbrella.svg" alt="Post Umbrella" />
    </div>
    <h1>Post Umbrella</h1>
    <p class="subtitle">Sign in to continue</p>

    <form id="magic-link-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" placeholder="you@example.com" required />
      </div>
      <button type="submit" class="btn-primary" id="magic-btn">Send Magic Link</button>
    </form>

    <div id="success-view" class="success-view">
      <h2>Check your email</h2>
      <p>We sent a magic link to <strong id="sent-email"></strong></p>
      <p>Click the link in your email to sign in.</p>
    </div>

    <div id="message" class="message" style="display:none"></div>
    <p class="hint">We'll email you a magic link to finish signing in.</p>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script>
    const SESSION_ID = '${sessionId}';
    const BASE_URL = '${BASE_URL}';
    const msgEl = document.getElementById('message');
    const formEl = document.getElementById('magic-link-form');
    const emailEl = document.getElementById('email');
    const magicBtn = document.getElementById('magic-btn');
    const titleEl = document.querySelector('h1');
    const subtitleEl = document.querySelector('.subtitle');
    const hintEl = document.querySelector('.hint');
    const successViewEl = document.getElementById('success-view');
    const sentEmailEl = document.getElementById('sent-email');

    function showMessage(text, type) {
      msgEl.textContent = text;
      msgEl.className = 'message ' + type;
      msgEl.style.display = 'block';
    }

    function showEmailSentState(email) {
      titleEl.textContent = 'Post Umbrella';
      subtitleEl.textContent = 'Sign in to continue';
      formEl.style.display = 'none';
      msgEl.style.display = 'none';
      hintEl.style.display = 'none';
      successViewEl.style.display = 'block';
      sentEmailEl.textContent = email;
    }

    function createSupabaseClient() {
      if (!window.supabase?.createClient) {
        throw new Error('Supabase browser client failed to load');
      }
      return window.supabase.createClient('${SUPABASE_URL}', '${SUPABASE_ANON_KEY}', {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
      });
    }

    async function checkEmailAllowed(supabase, email) {
      const { data, error } = await supabase.rpc('check_email_allowed', {
        check_email: email,
      });

      if (error) {
        console.warn('check_email_allowed RPC not available:', error.message);
        return { allowed: true, status: null, message: null };
      }

      return data;
    }

    async function completeExistingSession(session) {
      const res = await fetch(BASE_URL + '/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: SESSION_ID,
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          user_id: session.user.id,
          email: session.user.email,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to complete existing session');
      }

      const { code } = await res.json();
      const pendingRes = await fetch(BASE_URL + '/auth/redirect-info?code=' + code);
      const { redirect_uri, state } = await pendingRes.json();
      window.location.href = redirect_uri + '?code=' + code + '&state=' + state;
    }

    async function tryAutoAuth() {
      try {
        const supabase = createSupabaseClient();
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('Auto-auth session lookup failed', error);
          return;
        }
        if (!session?.user) {
          return;
        }

        magicBtn.disabled = true;
        magicBtn.textContent = 'Signing in...';
        showMessage('Using your existing session...', 'success');
        await completeExistingSession(session);
      } catch (error) {
        console.warn('Auto-auth failed', error);
        magicBtn.disabled = false;
        magicBtn.textContent = 'Send Magic Link';
        msgEl.style.display = 'none';
      }
    }

    // Always intercept submit so the form never falls through to /authorize.
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();

      try {
        const supabase = createSupabaseClient();
        const email = emailEl.value.trim();

        magicBtn.disabled = true;
        magicBtn.textContent = 'Sending link...';

        const checkResult = await checkEmailAllowed(supabase, email);
        if (!checkResult?.allowed) {
          throw new Error(checkResult.message || 'This email is not registered.');
        }

        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: BASE_URL + '/auth/callback?session_id=' + SESSION_ID }
        });

        if (error) {
          throw error;
        }

        showEmailSentState(email);
      } catch (error) {
        console.error('Magic link sign-in failed', error);
        showMessage(error.message || 'Failed to start magic link sign-in', 'error');
        magicBtn.disabled = false;
        magicBtn.textContent = 'Send Magic Link';
      }
    });

    tryAutoAuth();
  </script>
</body>
</html>`;
}

function callbackPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Authenticating...</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a; color: #e5e5e5;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .container { text-align: center; }
    h1 { font-size: 18px; margin-bottom: 12px; }
    p { color: #737373; font-size: 14px; }
    .spinner {
      width: 32px; height: 32px; border: 3px solid #333; border-top-color: #3b82f6;
      border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error { color: #f87171; margin-top: 12px; }
    .success { color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner" id="spinner"></div>
    <h1 id="title">Authenticating...</h1>
    <p id="subtitle">Completing sign in</p>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script>
    (async () => {
      const BASE_URL = '${BASE_URL}';
      const titleEl = document.getElementById('title');
      const subtitleEl = document.getElementById('subtitle');
      const spinnerEl = document.getElementById('spinner');

      try {
        const supabaseClient = window.supabase.createClient(
          '${SUPABASE_URL}', '${SUPABASE_ANON_KEY}',
          { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: true } }
        );

        // Get session_id from URL params
        const urlParams = new URLSearchParams(window.location.search);
        let sessionId = urlParams.get('session_id');

        // Also check hash params (Supabase sometimes puts session_id there)
        if (!sessionId) {
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          sessionId = hashParams.get('session_id');
        }

        if (!sessionId) throw new Error('Missing session ID');

        // Wait for Supabase to process the auth tokens from hash
        const session = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Authentication timed out')), 15000);

          supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
              clearTimeout(timeout);
              resolve(session);
            }
          });

          // Also try getSession (in case already processed)
          setTimeout(async () => {
            const { data } = await supabaseClient.auth.getSession();
            if (data.session) {
              clearTimeout(timeout);
              resolve(data.session);
            }
          }, 500);
        });

        // Send tokens to server
        const res = await fetch(BASE_URL + '/auth/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_at: session.expires_at,
            user_id: session.user.id,
            email: session.user.email,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to complete authentication');
        }

        const { code } = await res.json();

        // Get the original redirect_uri and state from pending auth
        // The server stored them — we get them back via the code
        // Redirect to Claude Code's localhost callback
        const pendingRes = await fetch(BASE_URL + '/auth/redirect-info?code=' + code);
        const { redirect_uri, state } = await pendingRes.json();

        spinnerEl.style.display = 'none';
        titleEl.textContent = 'Authenticated!';
        titleEl.classList.add('success');
        subtitleEl.textContent = 'Redirecting back to your AI agent...';

        // Redirect to Claude Code
        window.location.href = redirect_uri + '?code=' + code + '&state=' + state;

      } catch (err) {
        spinnerEl.style.display = 'none';
        titleEl.textContent = 'Authentication Failed';
        subtitleEl.innerHTML = '<span class="error">' + err.message + '</span>';
      }
    })();
  </script>
</body>
</html>`;
}
