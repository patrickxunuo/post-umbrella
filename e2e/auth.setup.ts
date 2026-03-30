import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';

const STORAGE_STATE_PATH = 'e2e/.auth/user.json';

// Supabase credentials - default to local, but env vars can override
// For production testing, set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';

// Service role key - set via SUPABASE_SERVICE_ROLE_KEY env var
// Required for admin operations like generating magic links
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Log the Supabase URL being used for debugging
console.log(`Using Supabase URL: ${SUPABASE_URL}`);

// Test user email - must exist in the system
const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'patrick@emonster.ca';

// Get existing auth state info
function getExistingAuthInfo(): { valid: boolean; refreshToken?: string; storageKey?: string } {
  try {
    if (!fs.existsSync(STORAGE_STATE_PATH)) {
      console.log('No existing auth state file');
      return { valid: false };
    }

    const authState = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf-8'));
    const origins = authState?.origins || [];

    for (const origin of origins) {
      for (const item of origin.localStorage || []) {
        if (item.name.includes('auth-token')) {
          const tokenData = JSON.parse(item.value);
          const expiresAt = tokenData.expires_at;
          const refreshToken = tokenData.refresh_token;
          const nowSeconds = Math.floor(Date.now() / 1000);

          if (expiresAt) {
            // Check if token expires more than 5 minutes from now
            const isValid = expiresAt > nowSeconds + 300;
            console.log(`Existing auth token expires at ${expiresAt}, now is ${nowSeconds}, valid: ${isValid}`);
            return {
              valid: isValid,
              refreshToken,
              storageKey: item.name
            };
          }
        }
      }
    }
    console.log('No auth token found in existing state');
    return { valid: false };
  } catch (e) {
    console.log('Error checking existing auth:', e);
    return { valid: false };
  }
}

// Refresh the session using the refresh token
async function refreshSession(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  user: any;
} | null> {
  try {
    console.log('Attempting to refresh session...');
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.log('Failed to refresh session:', res.status, text);
      return null;
    }

    const data = await res.json();
    console.log('Session refreshed successfully, expires at:', data.expires_at);
    return data;
  } catch (e) {
    console.log('Error refreshing session:', e);
    return null;
  }
}

// Update auth state file with new session
function updateAuthState(storageKey: string, newSession: any): void {
  const authState = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf-8'));
  const origins = authState?.origins || [];

  for (const origin of origins) {
    for (const item of origin.localStorage || []) {
      if (item.name === storageKey) {
        item.value = JSON.stringify(newSession);
        break;
      }
    }
  }

  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(authState, null, 2));
  console.log('Auth state file updated');
}

// Helper to make admin API calls
async function supabaseAdmin(endpoint: string, method = 'GET', body?: object) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 409) { // 409 = conflict (already exists)
    const text = await res.text();
    throw new Error(`Admin API error: ${res.status} ${text}`);
  }
  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json();
  }
  return null;
}

// Ensure test user has a workspace
async function ensureTestUserHasWorkspace(userId: string) {
  const now = Math.floor(Date.now() / 1000);

  // Check if user has any workspaces
  const workspaces = await supabaseAdmin(
    `workspace_members?user_id=eq.${userId}&select=workspace_id`
  );

  if (workspaces && workspaces.length > 0) {
    console.log('User already has workspace(s)');
    return;
  }

  console.log('Creating workspace for test user...');

  // Create a workspace
  const workspaceId = crypto.randomUUID();
  await supabaseAdmin('workspaces', 'POST', {
    id: workspaceId,
    name: 'Test Workspace',
    description: 'Created by E2E test setup',
    created_by: userId,
    created_at: now,
    updated_at: now,
  });

  // Add user as member
  await supabaseAdmin('workspace_members', 'POST', {
    workspace_id: workspaceId,
    user_id: userId,
    created_at: now,
  });

  // Set as active workspace
  await supabaseAdmin('user_active_workspace', 'POST', {
    user_id: userId,
    workspace_id: workspaceId,
  });

  console.log('Created workspace:', workspaceId);
}

// Ensure user profile exists
async function ensureUserProfile(userId: string, email: string) {
  const now = Math.floor(Date.now() / 1000);

  // Check if profile exists
  const profiles = await supabaseAdmin(
    `user_profiles?user_id=eq.${userId}&select=user_id,status`
  );

  if (profiles && profiles.length > 0) {
    console.log('User profile exists, status:', profiles[0].status);
    // If pending, activate it
    if (profiles[0].status === 'pending') {
      await supabaseAdmin(
        `user_profiles?user_id=eq.${userId}`,
        'PATCH',
        { status: 'active', activated_at: now, updated_at: now }
      );
      console.log('Activated user profile');
    }
    return;
  }

  console.log('Creating user profile...');
  await supabaseAdmin('user_profiles', 'POST', {
    user_id: userId,
    email: email,
    role: 'admin',
    status: 'active',
    created_at: now,
    updated_at: now,
    activated_at: now,
  });
  console.log('Created user profile as admin');
}

setup('authenticate via admin API', async ({ page }) => {
  // Check existing auth state
  const authInfo = getExistingAuthInfo();

  if (authInfo.valid) {
    console.log('Existing auth state is valid, skipping authentication');
    return;
  }

  // Try to refresh if we have a refresh token
  if (authInfo.refreshToken && authInfo.storageKey) {
    const newSession = await refreshSession(authInfo.refreshToken);
    if (newSession) {
      updateAuthState(authInfo.storageKey, newSession);
      console.log('Session refreshed successfully, skipping full re-authentication');
      return;
    }
    console.log('Refresh failed, proceeding with full authentication');
  }

  console.log('Authenticating user:', TEST_EMAIL);

  // Step 1: Generate a magic link via Admin API (doesn't send email, just returns the link)
  const generateLinkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({
      type: 'magiclink',
      email: TEST_EMAIL,
      options: {
        redirectTo: 'http://127.0.0.1:5173',
      },
    }),
  });

  if (!generateLinkRes.ok) {
    const error = await generateLinkRes.text();
    throw new Error(`Failed to generate link: ${error}`);
  }

  const linkData = await generateLinkRes.json();
  console.log('Generated magic link for:', linkData.email);

  // Get user ID and action link
  const userId = linkData.id;
  const actionLink = linkData.action_link || linkData.properties?.action_link;

  if (!userId) {
    console.log('Full response:', JSON.stringify(linkData, null, 2));
    throw new Error('No user ID in response');
  }

  if (!actionLink) {
    console.log('Full response:', JSON.stringify(linkData, null, 2));
    throw new Error('No action_link in response');
  }

  // Step 2: Ensure user has profile and workspace (admin API - bypasses RLS)
  console.log('Setting up test user data for:', userId);
  await ensureUserProfile(userId, TEST_EMAIL);
  await ensureTestUserHasWorkspace(userId);

  console.log('Visiting magic link...');

  // Listen for page errors before navigating
  page.on('pageerror', err => {
    console.log(`[PAGE ERROR]: ${err.message}`);
  });

  // Capture ALL browser console logs for debugging
  page.on('console', msg => {
    console.log(`[Browser ${msg.type()}]: ${msg.text()}`);
  });

  // Also capture network errors
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`[Network Error]: ${response.status()} ${response.url()}`);
    }
  });

  // Step 2: Visit the magic link directly - Supabase will verify and redirect
  await page.goto(actionLink);

  // Wait for redirect to complete (should go to 127.0.0.1:5173)
  await page.waitForURL('**/127.0.0.1:5173/**', { timeout: 15000 });

  console.log('Redirected to:', page.url());

  // Wait a moment for the app to load
  await page.waitForTimeout(2000);

  // Check if localStorage has the auth token stored (Supabase would do this after processing hash)
  const localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
  console.log('LocalStorage keys:', localStorageKeys);

  // Check if auth token is present
  const authToken = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.includes('auth-token')) {
        return localStorage.getItem(key);
      }
    }
    return null;
  });
  console.log('Auth token in localStorage:', authToken ? 'Present (length: ' + authToken.length + ')' : 'Not found');

  // Step 3: Wait for app to load with authenticated state
  // Supabase's detectSessionInUrl processes the hash parameters asynchronously
  // The app needs time to detect the session and update React state
  // We wait for the workspace selector to appear (which only shows when authenticated)

  const workspaceLabel = page.locator('.workspace-selector-label');
  const loginForm = page.locator('form:has(input[type="email"])');

  // Poll for either workspace label to appear (authenticated) or stay on login
  // Give it longer since Supabase needs to process the hash token
  let authenticated = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);

    // Check if workspace label is visible (means we're authenticated)
    if (await workspaceLabel.isVisible().catch(() => false)) {
      const text = await workspaceLabel.textContent();
      if (text && text !== 'Loading...') {
        authenticated = true;
        console.log('Authenticated! Workspace:', text);
        break;
      }
    }

    // Log progress every 5 iterations
    if (i % 10 === 0 && i > 0) {
      const url = page.url();
      const hasToken = url.includes('access_token');
      console.log(`Poll ${i}: hasToken=${hasToken}, url=${url.substring(0, 80)}...`);
    }

    // If hash is gone from URL, Supabase processed it - give a bit more time
    if (!page.url().includes('access_token')) {
      console.log('Token processed, waiting for app state update...');
    }
  }

  if (!authenticated) {
    // Still not authenticated - check for errors
    const isLoginVisible = await loginForm.isVisible().catch(() => false);
    if (isLoginVisible) {
      const errorMsg = await page.locator('.login-error').textContent().catch(() => null);
      if (errorMsg) {
        throw new Error(`Login failed: ${errorMsg}`);
      }
      await page.screenshot({ path: 'e2e/screenshots/auth-debug.png' });
      throw new Error('Auth failed - still on login page after 10s. Check e2e/screenshots/auth-debug.png');
    }
    throw new Error('Auth failed - workspace selector not visible after 10s');
  }

  console.log('Successfully authenticated!');

  // Wait for workspace to be fully loaded
  await expect(workspaceLabel).not.toHaveText('Loading...', { timeout: 10000 });
  await expect(workspaceLabel).not.toHaveText('No Workspace', { timeout: 10000 });

  console.log('Workspace loaded:', await workspaceLabel.textContent());

  // Save authentication state
  await page.context().storageState({ path: STORAGE_STATE_PATH });
  console.log('Auth state saved to', STORAGE_STATE_PATH);
});
