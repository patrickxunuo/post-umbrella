// Supabase Data Provider
import { supabase, PROXY_FUNCTION_URL } from './client.js';

// Batch large .in() queries to avoid URL length limits (PostgREST 400 errors)
const BATCH_SIZE = 100;
const batchedIn = async (table, column, ids, select = '*', extraFilters) => {
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

// Auth state storage (for compatibility with existing code)
let currentUser = null;

export const setAuthToken = (token) => {
  // Supabase handles tokens internally, this is for interface compatibility
  if (!token) {
    currentUser = null;
  }
};

export const getCurrentUser = () => currentUser;

export const setCurrentUser = (user) => {
  currentUser = user;
  if (user) {
    localStorage.setItem('auth_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('auth_user');
  }
};

// Initialize user from Supabase session
const initUser = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = {
      id: session.user.id,
      email: session.user.email,
    };
  }
};
initUser();

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
  currentUser = null;
  setCurrentUser(null);
};

export const checkAuth = async () => {
  // If desktop app received auth tokens via deep link, set session explicitly
  if (window.__DEEP_LINK_AUTH__) {
    const { access_token, refresh_token } = window.__DEEP_LINK_AUTH__;
    delete window.__DEEP_LINK_AUTH__;
    if (access_token && refresh_token) {
      // Try setSession first (works if access token is still valid)
      let { data: { session }, error } = await supabase.auth.setSession({ access_token, refresh_token });

      // If access token expired, refresh using the refresh token
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

  // If token is expired or about to expire, force a refresh
  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  if (Date.now() > expiresAt - 60000) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      // Refresh failed — session is truly dead, force logout
      await supabase.auth.signOut();
      throw new Error('Session expired. Please log in again.');
    }
    session = refreshData.session;
  }

  currentUser = {
    id: session.user.id,
    email: session.user.email,
  };
  return currentUser;
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
      currentUser = {
        id: session.user.id,
        email: session.user.email,
      };
      callback(event, currentUser);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      callback(event, null);
    }
  });
  return subscription;
};

// Collections
export const getCollections = async (workspaceId = null) => {
  // Fetch collections (filtered by workspace_id if provided)
  let collQuery = supabase.from('collections').select('*');
  if (workspaceId) {
    // Get top-level collections in this workspace, plus all their children
    collQuery = collQuery.eq('workspace_id', workspaceId);
  }
  const { data: topLevelCollections, error: collError } = await collQuery.order('created_at', { ascending: true });
  if (collError) throw new Error(collError.message);

  // If no collections, return early
  if (!topLevelCollections || topLevelCollections.length === 0) {
    return [];
  }

  // Get all child collections (they inherit workspace from parent)
  const topLevelIds = topLevelCollections.map(c => c.id);
  let allCollections = [...topLevelCollections];

  // Recursively fetch children
  const fetchChildren = async (parentIds) => {
    if (parentIds.length === 0) return;
    const { data: children, error } = await supabase
      .from('collections')
      .select('*')
      .in('parent_id', parentIds)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    if (children && children.length > 0) {
      allCollections = [...allCollections, ...children];
      await fetchChildren(children.map(c => c.id));
    }
  };
  await fetchChildren(topLevelIds);

  // Fetch all requests for these collections (batched to avoid URL length limits)
  const allCollectionIds = allCollections.map(c => c.id);
  const requests = allCollectionIds.length > 0
    ? await batchedIn('requests', 'collection_id', allCollectionIds, '*', q =>
        q.order('sort_order', { ascending: true, nullsFirst: false })
         .order('created_at', { ascending: true }))
    : [];

  // Get example counts for all requests (batched to avoid URL length limits)
  const requestIds = requests?.map(r => r.id) || [];
  const exampleCounts = requestIds.length > 0
    ? await batchedIn('examples', 'request_id', requestIds, 'request_id')
    : [];

  // Build count map
  const countMap = {};
  exampleCounts.forEach(ec => {
    countMap[ec.request_id] = (countMap[ec.request_id] || 0) + 1;
  });

  // Build tree structure with nested requests
  const collectionsWithRequests = allCollections.map(col => ({
    ...col,
    requests: (requests || [])
      .filter(r => r.collection_id === col.id)
      .map(r => ({
        ...r,
        headers: typeof r.headers === 'string' ? JSON.parse(r.headers || '[]') : (r.headers || []),
        params: typeof r.params === 'string' ? JSON.parse(r.params || '[]') : (r.params || []),
        form_data: typeof r.form_data === 'string' ? JSON.parse(r.form_data || '[]') : (r.form_data || []),
        example_count: countMap[r.id] || 0,
      })),
  }));

  return collectionsWithRequests;
};

export const createCollection = async (collection) => {
  const collectionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const { data, error } = await supabase
    .from('collections')
    .insert({
      id: collectionId,
      name: collection.name,
      parent_id: collection.parent_id || null,
      workspace_id: collection.workspace_id || null,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  return data;
};

export const updateCollection = async (id, updates) => {
  const { data, error } = await supabase
    .from('collections')
    .update({
      ...updates,
      updated_at: Math.floor(Date.now() / 1000),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
};

export const deleteCollection = async (id) => {
  const { error } = await supabase
    .from('collections')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
  return null;
};

// Fetch a single collection tree (with children and requests) by root ID
export const getCollectionTree = async (rootId) => {
  // Fetch the root collection
  const { data: rootCollection, error: rootError } = await supabase
    .from('collections')
    .select('*')
    .eq('id', rootId)
    .single();
  if (rootError) throw new Error(rootError.message);

  let allCollections = [rootCollection];

  // Recursively fetch children
  const fetchChildren = async (parentIds) => {
    if (parentIds.length === 0) return;
    const { data: children, error } = await supabase
      .from('collections')
      .select('*')
      .in('parent_id', parentIds)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    if (children && children.length > 0) {
      allCollections = [...allCollections, ...children];
      await fetchChildren(children.map(c => c.id));
    }
  };
  await fetchChildren([rootId]);

  // Fetch all requests for these collections
  const allCollectionIds = allCollections.map(c => c.id);
  const { data: requests, error: reqError } = await supabase
    .from('requests')
    .select('*')
    .in('collection_id', allCollectionIds)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (reqError) throw new Error(reqError.message);

  // Build collections with requests
  return allCollections.map(col => ({
    ...col,
    requests: (requests || [])
      .filter(r => r.collection_id === col.id)
      .map(r => ({
        ...r,
        headers: typeof r.headers === 'string' ? JSON.parse(r.headers || '[]') : (r.headers || []),
        params: typeof r.params === 'string' ? JSON.parse(r.params || '[]') : (r.params || []),
        form_data: typeof r.form_data === 'string' ? JSON.parse(r.form_data || '[]') : (r.form_data || []),
        example_count: 0,
      })),
  }));
};

// Requests
// Helper to parse request JSON fields
const parseRequest = (request) => ({
  ...request,
  headers: typeof request.headers === 'string' ? JSON.parse(request.headers || '[]') : (request.headers || []),
  params: typeof request.params === 'string' ? JSON.parse(request.params || '[]') : (request.params || []),
  form_data: typeof request.form_data === 'string' ? JSON.parse(request.form_data || '[]') : (request.form_data || []),
});

export const getRequests = async (collectionId) => {
  let query = supabase.from('requests').select('*');
  if (collectionId) {
    query = query.eq('collection_id', collectionId);
  }
  const { data, error } = await query.order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data.map(parseRequest);
};

export const getRequest = async (id) => {
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return parseRequest(data);
};

export const createRequest = async (request) => {
  const { data, error } = await supabase
    .from('requests')
    .insert({
      id: crypto.randomUUID(),
      collection_id: request.collection_id,
      name: request.name || 'New Request',
      method: request.method || 'GET',
      url: request.url || '',
      headers: request.headers ? JSON.stringify(request.headers) : '[]',
      body: request.body || '',
      body_type: request.body_type || 'none',
      form_data: request.form_data ? JSON.stringify(request.form_data) : null,
      params: request.params ? JSON.stringify(request.params) : null,
      auth_type: request.auth_type || 'none',
      auth_token: request.auth_token || '',
      pre_script: request.pre_script || '',
      post_script: request.post_script || '',
      sort_order: request.sort_order || 0,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return parseRequest(data);
};

export const updateRequest = async (id, updates) => {
  const updateData = {
    updated_at: Math.floor(Date.now() / 1000),
  };

  // Convert objects to JSON strings for storage
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.method !== undefined) updateData.method = updates.method;
  if (updates.url !== undefined) updateData.url = updates.url;
  if (updates.headers !== undefined) updateData.headers = JSON.stringify(updates.headers);
  if (updates.body !== undefined) updateData.body = updates.body;
  if (updates.body_type !== undefined) updateData.body_type = updates.body_type;
  if (updates.form_data !== undefined) updateData.form_data = JSON.stringify(updates.form_data);
  if (updates.params !== undefined) updateData.params = JSON.stringify(updates.params);
  if (updates.auth_type !== undefined) updateData.auth_type = updates.auth_type;
  if (updates.auth_token !== undefined) updateData.auth_token = updates.auth_token;
  if (updates.pre_script !== undefined) updateData.pre_script = updates.pre_script;
  if (updates.post_script !== undefined) updateData.post_script = updates.post_script;
  if (updates.sort_order !== undefined) updateData.sort_order = updates.sort_order;
  if (updates.collection_id !== undefined) updateData.collection_id = updates.collection_id;

  const { data, error } = await supabase
    .from('requests')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return parseRequest(data);
};

export const deleteRequest = async (id) => {
  const { error } = await supabase
    .from('requests')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
  return null;
};

export const reorderRequests = async (collectionId, requestIds) => {
  await Promise.all(requestIds.map((id, index) =>
    supabase
      .from('requests')
      .update({ sort_order: index })
      .eq('id', id)
      .then(({ error }) => { if (error) throw new Error(error.message); })
  ));
  return { success: true };
};

export const moveRequest = async (requestId, collectionId) => {
  const { data, error } = await supabase
    .from('requests')
    .update({ collection_id: collectionId })
    .eq('id', requestId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return parseRequest(data);
};

export const reorderCollections = async (parentId, collectionIds) => {
  await Promise.all(collectionIds.map((id, index) =>
    supabase
      .from('collections')
      .update({ sort_order: index })
      .eq('id', id)
      .then(({ error }) => { if (error) throw new Error(error.message); })
  ));
  return { success: true };
};

export const moveCollection = async (collectionId, newParentId) => {
  const { data, error } = await supabase
    .from('collections')
    .update({ parent_id: newParentId })
    .eq('id', collectionId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
};

export const reorderExamples = async (requestId, exampleIds) => {
  await Promise.all(exampleIds.map((id, index) =>
    supabase
      .from('examples')
      .update({ sort_order: index })
      .eq('id', id)
      .then(({ error }) => { if (error) throw new Error(error.message); })
  ));
  return { success: true };
};

// Examples
// Helper to parse example JSON fields
const parseExample = (example) => ({
  ...example,
  request_data: typeof example.request_data === 'string' ? JSON.parse(example.request_data || '{}') : (example.request_data || {}),
  response_data: typeof example.response_data === 'string' ? JSON.parse(example.response_data || '{}') : (example.response_data || {}),
});

export const getExamples = async (requestId) => {
  let query = supabase.from('examples').select('*');
  if (requestId) {
    query = query.eq('request_id', requestId);
  }
  const { data, error } = await query
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map(parseExample);
};

export const getExample = async (id) => {
  const { data, error } = await supabase
    .from('examples')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return parseExample(data);
};

export const createExample = async (example) => {
  const { data, error } = await supabase
    .from('examples')
    .insert({
      id: crypto.randomUUID(),
      request_id: example.request_id,
      name: example.name,
      request_data: JSON.stringify(example.request_data),
      response_data: JSON.stringify(example.response_data),
      created_at: Math.floor(Date.now() / 1000),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return parseExample(data);
};

export const updateExample = async (id, updates) => {
  const updateData = {};
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.request_data !== undefined) updateData.request_data = JSON.stringify(updates.request_data);
  if (updates.response_data !== undefined) updateData.response_data = JSON.stringify(updates.response_data);

  const { data, error } = await supabase
    .from('examples')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return parseExample(data);
};

export const deleteExample = async (id) => {
  const { error } = await supabase
    .from('examples')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
  return null;
};

// Environments
// Now workspace-scoped with normalized variables table

// Get environments for a workspace
export const getEnvironments = async (workspaceId) => {
  const user = await checkAuth();

  // Get environments with their variables
  const { data: environments, error: envError } = await supabase
    .from('environments')
    .select(`
      *,
      environment_variables (
        id,
        key,
        initial_value,
        enabled,
        sort_order
      )
    `)
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true });
  if (envError) throw new Error(envError.message);

  if (!environments || environments.length === 0) {
    return [];
  }

  // Get active environment for this user and workspace
  const { data: activeEnv } = await supabase
    .from('user_active_environment')
    .select('environment_id')
    .eq('user_id', user.id)
    .eq('workspace_id', workspaceId)
    .single();

  const activeEnvId = activeEnv?.environment_id;

  // Get all variable IDs across all environments
  const allVarIds = environments.flatMap(e =>
    (e.environment_variables || []).map(v => v.id)
  );

  // Get user's current values
  let userValuesMap = {};
  if (allVarIds.length > 0) {
    const { data: userValues } = await supabase
      .from('environment_user_values')
      .select('variable_id, current_value')
      .eq('user_id', user.id)
      .in('variable_id', allVarIds);

    (userValues || []).forEach(uv => {
      userValuesMap[uv.variable_id] = uv.current_value;
    });
  }

  return environments.map(env => ({
    ...env,
    variables: (env.environment_variables || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(v => {
        const current_value = userValuesMap[v.id] || '';
        return {
          id: v.id,
          key: v.key,
          initial_value: v.initial_value || '',
          current_value,
          value: current_value || v.initial_value || '',
          enabled: v.enabled !== false,
        };
      }),
    environment_variables: undefined, // Remove raw join data
    is_active: env.id === activeEnvId,
  }));
};




export const createEnvironment = async (environment) => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);
  const envId = crypto.randomUUID();

  // Create the environment
  const { data, error } = await supabase
    .from('environments')
    .insert({
      id: envId,
      name: environment.name,
      workspace_id: environment.workspace_id,
      created_by: user.id,
      updated_by: user.id,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Insert variables into environment_variables table
  const variables = (environment.variables || []).map((v, index) => ({
    id: crypto.randomUUID(),
    environment_id: envId,
    key: v.key,
    initial_value: v.initial_value ?? v.value ?? '',
    enabled: v.enabled !== false,
    sort_order: index,
    created_at: now,
    updated_at: now,
  }));

  let createdVars = [];
  if (variables.length > 0) {
    const { data: varData, error: varError } = await supabase
      .from('environment_variables')
      .insert(variables)
      .select();
    if (varError) throw new Error(varError.message);
    createdVars = varData || [];
  }

  return {
    ...data,
    variables: createdVars.map(v => ({
      id: v.id,
      key: v.key,
      initial_value: v.initial_value || '',
      current_value: '',
      value: v.initial_value || '',
      enabled: v.enabled !== false,
    })),
  };
};

// Update environment (name and/or add new variables)
export const updateEnvironment = async (id, updates) => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);

  // Update environment metadata
  const updateData = {
    updated_by: user.id,
    updated_at: now,
  };
  if (updates.name !== undefined) updateData.name = updates.name;

  const { data, error } = await supabase
    .from('environments')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Handle variable changes if provided
  if (updates.variables !== undefined) {
    // Get existing variables
    const { data: existingVars } = await supabase
      .from('environment_variables')
      .select('id, key')
      .eq('environment_id', id);

    const existingVarsMap = new Map((existingVars || []).map(v => [v.key, v.id]));
    const updatedKeys = new Set(updates.variables.filter(v => v.key).map(v => v.key));

    // Find variables to delete (exist in DB but not in updates)
    const varsToDelete = (existingVars || []).filter(v => !updatedKeys.has(v.key));

    // Delete removed variables (CASCADE will delete user values too)
    if (varsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('environment_variables')
        .delete()
        .in('id', varsToDelete.map(v => v.id));
      if (deleteError) throw new Error(deleteError.message);
    }

    // Find new variables to insert
    const newVars = updates.variables.filter(v => v.key && !existingVarsMap.has(v.key));

    // Get max sort_order for new variables
    const maxOrder = (existingVars || []).length - varsToDelete.length;

    // Insert new variables
    if (newVars.length > 0) {
      const varsToInsert = newVars.map((v, index) => ({
        id: crypto.randomUUID(),
        environment_id: id,
        key: v.key,
        initial_value: v.initial_value ?? v.value ?? '',
        enabled: v.enabled !== false,
        sort_order: maxOrder + index,
        created_at: now,
        updated_at: now,
      }));

      const { error: insertError } = await supabase
        .from('environment_variables')
        .insert(varsToInsert);
      if (insertError) throw new Error(insertError.message);
    }
  }

  // Fetch updated variables with user's current values
  const { data: vars } = await supabase
    .from('environment_variables')
    .select('id, key, initial_value, enabled, sort_order')
    .eq('environment_id', id)
    .order('sort_order');

  const varIds = (vars || []).map(v => v.id);
  let userValuesMap = {};

  if (varIds.length > 0) {
    const { data: userValues } = await supabase
      .from('environment_user_values')
      .select('variable_id, current_value')
      .eq('user_id', user.id)
      .in('variable_id', varIds);

    (userValues || []).forEach(uv => {
      userValuesMap[uv.variable_id] = uv.current_value;
    });
  }

  return {
    ...data,
    variables: (vars || []).map(v => {
      const current_value = userValuesMap[v.id] || '';
      return {
        id: v.id,
        key: v.key,
        initial_value: v.initial_value || '',
        current_value,
        value: current_value || v.initial_value || '',
        enabled: v.enabled !== false,
      };
    }),
  };
};

// Update user's current values (private, not synced)
// currentValues can be { variableKey: value } or { variableId: value }
export const updateCurrentValues = async (environmentId, currentValues) => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);

  // Get variables for this environment to map keys to IDs
  const { data: vars } = await supabase
    .from('environment_variables')
    .select('id, key')
    .eq('environment_id', environmentId);

  const keyToId = {};
  (vars || []).forEach(v => {
    keyToId[v.key] = v.id;
  });

  const entries = Object.entries(currentValues);

  for (const [keyOrId, currentValue] of entries) {
    // Determine if keyOrId is a UUID or a variable key
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keyOrId);
    const variableId = isUuid ? keyOrId : keyToId[keyOrId];

    if (!variableId) continue; // Skip if variable not found

    if (currentValue === null || currentValue === undefined || currentValue === '') {
      // Delete if empty/null
      await supabase
        .from('environment_user_values')
        .delete()
        .eq('variable_id', variableId)
        .eq('user_id', user.id);
    } else {
      // Upsert the current value
      const { error } = await supabase
        .from('environment_user_values')
        .upsert({
          variable_id: variableId,
          user_id: user.id,
          current_value: currentValue,
          updated_at: now,
        }, {
          onConflict: 'variable_id,user_id',
        });
      if (error) throw new Error(error.message);
    }
  }

  return { success: true };
};

export const activateEnvironment = async (id) => {
  const user = await checkAuth();

  // Get the environment to find its workspace_id
  const { data: env, error: envError } = await supabase
    .from('environments')
    .select('workspace_id')
    .eq('id', id)
    .single();
  if (envError) throw new Error(envError.message);

  // Upsert the active environment for this workspace
  const { error } = await supabase
    .from('user_active_environment')
    .upsert({
      user_id: user.id,
      workspace_id: env.workspace_id,
      environment_id: id,
    }, {
      onConflict: 'user_id,workspace_id',
    });
  if (error) throw new Error(error.message);

  return { success: true };
};

export const deactivateEnvironments = async (workspaceId) => {
  const user = await checkAuth();

  const { error } = await supabase
    .from('user_active_environment')
    .delete()
    .eq('user_id', user.id)
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);

  return { success: true };
};

export const deleteEnvironment = async (id) => {
  const { error } = await supabase
    .from('environments')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
  return null;
};

// Proxy - send HTTP request via Edge Function
export const sendRequest = async (data, { signal } = {}) => {
  // In Tauri app, all requests go direct (Tauri HTTP plugin bypasses CORS at the system level)
  if ('__TAURI_INTERNALS__' in window) {
    return sendDirectRequest(data, signal);
  }

  // Check if URL points to a local/private address (should bypass remote proxy)
  const isLocal = (url) => {
    try {
      let urlToParse = url;
      if (!url.match(/^https?:\/\//i)) {
        urlToParse = 'http://' + url;
      }
      const parsed = new URL(urlToParse);
      const h = parsed.hostname;
      // Explicit localhost
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
      // Local TLDs (Herd, Valet, dnsmasq, etc.)
      if (/\.(test|local|localhost|invalid|example|wip|ddev\.site)$/i.test(h)) return true;
      // Private IP ranges
      if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
      return false;
    } catch (e) {
      return false;
    }
  };

  if (isLocal(data.url)) {
    return sendDirectRequest(data);
  }

  // Get session and check if token needs refresh
  let { data: { session } } = await supabase.auth.getSession();

  // Check if token is expired or about to expire (within 60 seconds)
  const isTokenExpired = () => {
    if (!session?.expires_at) return true;
    const expiresAt = session.expires_at * 1000; // Convert to ms
    return Date.now() > expiresAt - 60000; // 60 second buffer
  };
  console.log('is exipired: ', isTokenExpired())

  // Refresh if no session or token is expired/expiring
  if (!session || isTokenExpired()) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      throw new Error('Session expired. Please log in again.');
    }
    session = refreshData.session;
  }

  const accessToken = session.access_token;

  // Send via Edge Function proxy
  const response = await fetch(PROXY_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(data),
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Proxy request failed');
  }

  return response.json();
};

// Send request via custom Tauri command (pure reqwest, no Origin header, no CORS)
const sendTauriRequest = async (url, method, headersArr, bodyBytes, timeout) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('http_request', {
    method,
    url,
    headers: headersArr,
    body: bodyBytes,
    timeoutMs: timeout || 30000,
  });
};

// Direct request (uses Tauri IPC in desktop app, browser fetch otherwise)
const sendDirectRequest = async (data, signal) => {
  const { method, headers, body, bodyType, formData, timeout } = data;
  let url = data.url;
  if (!url.match(/^https?:\/\//i)) {
    url = 'http://' + url;
  }
  const startTime = Date.now();

  try {
    const headersArr = [];
    if (Array.isArray(headers)) {
      headers.forEach(h => {
        if (h.key && h.enabled !== false) {
          headersArr.push([h.key, String(h.value ?? '')]);
        }
      });
    }

    let bodyBytes = null;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase())) {
      if (bodyType === 'form-data' && Array.isArray(formData)) {
        // Build multipart body via browser FormData + Request
        const form = new FormData();
        for (const field of formData) {
          if (!field.key || field.enabled === false) continue;
          if (field.type === 'file' && field.value) {
            const byteString = atob(field.value);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: field.fileType || 'application/octet-stream' });
            form.append(field.key, blob, field.fileName || 'file');
          } else {
            form.append(field.key, field.value || '');
          }
        }
        const tmpReq = new Request('http://localhost', { method: 'POST', body: form });
        const buf = await tmpReq.arrayBuffer();
        bodyBytes = Array.from(new Uint8Array(buf));
        // Get the multipart content-type with boundary
        const ct = tmpReq.headers.get('content-type');
        if (ct && !headersArr.some(([k]) => k.toLowerCase() === 'content-type')) {
          headersArr.push(['Content-Type', ct]);
        }
      } else if (body) {
        bodyBytes = Array.from(new TextEncoder().encode(body));
      }
    }

    // Use custom Tauri command in desktop app (pure reqwest, no Origin header)
    if ('__TAURI_INTERNALS__' in window) {
      const tauriPromise = sendTauriRequest(url, method || 'GET', headersArr, bodyBytes, timeout);
      // Race against abort signal so UI unblocks immediately on cancel
      const res = signal
        ? await Promise.race([
            tauriPromise,
            new Promise((_, reject) => {
              if (signal.aborted) reject(new DOMException('The operation was aborted.', 'AbortError'));
              signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
            }),
          ])
        : await tauriPromise;
      const endTime = Date.now();

      const responseHeaders = (res.headers || []).map(([key, value]) => ({ key, value }));
      const contentType = responseHeaders.find(h => h.key.toLowerCase() === 'content-type')?.value || '';

      let responseBody;
      if (contentType.includes('application/json')) {
        try { responseBody = JSON.parse(res.body); } catch { responseBody = res.body; }
      } else {
        responseBody = res.body;
      }

      return {
        status: res.status,
        statusText: res.status_text,
        headers: responseHeaders,
        body: responseBody,
        time: endTime - startTime,
        size: res.body.length,
      };
    }

    // Browser path
    const headersObj = {};
    headersArr.forEach(([k, v]) => { headersObj[k] = v; });
    const config = { method: method || 'GET', headers: headersObj };
    if (bodyBytes && bodyType !== 'form-data') {
      config.body = body;
    } else if (bodyType === 'form-data') {
      // Rebuild FormData for browser
      const form = new FormData();
      for (const field of (formData || [])) {
        if (!field.key || field.enabled === false) continue;
        if (field.type === 'file' && field.value) {
          const byteString = atob(field.value);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
          const blob = new Blob([ab], { type: field.fileType || 'application/octet-stream' });
          form.append(field.key, blob, field.fileName || 'file');
        } else {
          form.append(field.key, field.value || '');
        }
      }
      config.body = form;
      delete config.headers['Content-Type'];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout || 30000);
    // If an external signal is provided, abort when it fires
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    config.signal = controller.signal;

    const response = await window.fetch(url, config);
    clearTimeout(timeoutId);

    const endTime = Date.now();
    let responseBody;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }
    const responseHeaders = [];
    response.headers.forEach((value, key) => { responseHeaders.push({ key, value }); });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      time: endTime - startTime,
      size: JSON.stringify(responseBody).length,
    };
  } catch (error) {
    const endTime = Date.now();

    if (error?.name === 'AbortError') {
      // If cancelled by external signal, re-throw so the caller can handle it
      if (signal?.aborted) throw error;
      return {
        status: 0,
        statusText: 'Timeout',
        headers: [],
        body: `Request timed out after ${timeout || 30000}ms`,
        time: endTime - startTime,
        size: 0,
        error: true,
      };
    }

    return {
      status: 0,
      statusText: 'Error',
      headers: [],
      body: error?.message || String(error) || 'Unknown error',
      time: endTime - startTime,
      size: 0,
      error: true,
    };
  }
};

// Import/Export
// Helper: Parse URL into Postman format
function parseUrl(urlString) {
  try {
    const url = new URL(urlString);
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname.split('.'),
      port: url.port || undefined,
      path: url.pathname.split('/').filter(Boolean),
      query: [...url.searchParams].map(([key, value]) => ({ key, value })),
    };
  } catch {
    return { raw: urlString };
  }
}

// Helper: Build Postman request format
function buildPostmanRequest(req, examples) {
  const headers = Array.isArray(req.headers) ? req.headers : [];

  const request = {
    method: req.method,
    header: headers.map(h => ({
      key: h.key,
      value: h.value,
      disabled: h.enabled === false,
    })),
    url: {
      raw: req.url,
      ...parseUrl(req.url),
    },
  };

  if (req.body && req.body_type !== 'none') {
    request.body = {
      mode: req.body_type === 'json' ? 'raw' : req.body_type,
      raw: req.body,
      options: req.body_type === 'json' ? { raw: { language: 'json' } } : undefined,
    };
  }

  return {
    name: req.name,
    request,
    response: examples.map(ex => {
      const exReqData = ex.request_data || {};
      const exResData = ex.response_data || {};
      return {
        name: ex.name,
        originalRequest: {
          method: exReqData.method || req.method,
          header: (exReqData.headers || []).map(h => ({
            key: h.key,
            value: h.value,
          })),
          url: { raw: exReqData.url || req.url },
          body: exReqData.body ? { mode: 'raw', raw: exReqData.body } : undefined,
        },
        status: exResData.statusText || '',
        code: exResData.status || 200,
        header: (exResData.headers || []).map(h => ({
          key: h.key,
          value: h.value,
        })),
        body: typeof exResData.body === 'string' ? exResData.body : JSON.stringify(exResData.body, null, 2),
        _postman_previewlanguage: 'json',
      };
    }),
  };
}

// Helper: Build Postman Collection v2.1 format
function buildPostmanCollection(collection, allCollections, allRequests, allExamples) {
  const collectionRequests = allRequests.filter(r => r.collection_id === collection.id);
  const childCollections = allCollections.filter(c => c.parent_id === collection.id);

  const items = [
    // Add requests
    ...collectionRequests.map(req => {
      const reqExamples = allExamples.filter(e => e.request_id === req.id);
      return buildPostmanRequest(req, reqExamples);
    }),
    // Add child folders recursively
    ...childCollections.map(child => ({
      name: child.name,
      item: buildPostmanCollection(child, allCollections, allRequests, allExamples).item,
    })),
  ];

  return {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
  };
}

export const exportCollection = async (id) => {
  const allCollections = await getCollections();
  const allRequests = await getRequests();
  const allExamples = await getExamples();

  const rootCollection = allCollections.find(c => c.id === id);
  if (!rootCollection) {
    throw new Error('Collection not found');
  }

  return buildPostmanCollection(rootCollection, allCollections, allRequests, allExamples);
};

export const importCollection = async (postmanData, workspaceId = null) => {
  await checkAuth();

  if (!postmanData || !postmanData.info) {
    throw new Error('Invalid Postman collection format');
  }

  // Get auth token for Edge Function
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  // Call Edge Function to handle the entire import
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const response = await fetch(`${supabaseUrl}/functions/v1/import-collection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ postmanData, workspaceId }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to import collection');
  }

  return result;
};

// Realtime subscriptions
let realtimeChannel = null;

export const subscribeToChanges = (callback, workspaceId = null) => {
  const getRealtimeData = (payload) => (
    payload.eventType === 'DELETE' ? payload.old : payload.new
  );

  // Unsubscribe from existing channel if any
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }

  // Create a channel for all table changes
  realtimeChannel = supabase
    .channel('db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'collections' },
      (payload) => callback({ type: `collection:${payload.eventType}`, data: getRealtimeData(payload) })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'requests' },
      (payload) => callback({ type: `request:${payload.eventType}`, data: getRealtimeData(payload) })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'examples' },
      (payload) => callback({ type: `example:${payload.eventType}`, data: getRealtimeData(payload) })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'environments' },
      (payload) => callback({ type: `environment:${payload.eventType}`, data: getRealtimeData(payload) })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'workspaces' },
      (payload) => callback({ type: `workspace:${payload.eventType}`, data: getRealtimeData(payload) })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'workspace_members' },
      (payload) => callback({ type: `workspace_member:${payload.eventType}`, data: getRealtimeData(payload) })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_profiles' },
      (payload) => callback({ type: `user_profile:${payload.eventType}`, data: getRealtimeData(payload) })
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  };
};

// ============================================
// USER PROFILES
// ============================================

// Get current user's profile
export const getUserProfile = async () => {
  const user = await checkAuth();

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  console.log('getUserProfile result:', { data, error });

  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data;
};

// Get all users (admin only)
export const getAllUsers = async () => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

// Update user profile (admin only, or self for activation)
export const updateUserProfile = async (userId, updates) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .update({
      ...updates,
      updated_at: Math.floor(Date.now() / 1000),
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
};

// Delete user (admin only - via edge function)
export const deleteUser = async (userId) => {
  const response = await fetch(`${PROXY_FUNCTION_URL.replace('/proxy', '/delete-user')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify({ userId }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to delete user');
  }

  return result;
};

// Bootstrap/activate user on login (via database function)
// Handles: pending activation, first-user-becomes-admin, unauthorized access
export const activateUser = async () => {
  // Debug: check current user
  const { data: { user } } = await supabase.auth.getUser();
  console.log('Current auth user:', user?.id, user?.email);

  // Debug: test auth.uid() directly
  const { data: uidData, error: uidError } = await supabase.rpc('get_my_uid');
  console.log('get_my_uid result:', { uidData, uidError });

  const { data, error } = await supabase.rpc('bootstrap_or_activate_user');

  console.log('bootstrap_or_activate_user result:', { data, error });

  if (error) {
    throw new Error(error.message || 'Failed to activate user');
  }

  if (!data.success) {
    const err = new Error(data.message || 'User activation failed');
    err.action = data.action;
    throw err;
  }

  return data;
};

// Invite new user (admin only - via edge function)
export const inviteUser = async (email, role, workspaceIds = []) => {
  const response = await fetch(`${PROXY_FUNCTION_URL.replace('/proxy', '/invite-user')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify({ email, role, workspaceIds }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to invite user');
  }

  return response.json();
};

// Get user's workspaces (for admin management)
export const getUserWorkspaces = async (userId) => {
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      workspace:workspaces (
        id,
        name
      )
    `)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return data.map(wm => wm.workspace).filter(Boolean);
};

// Update user's workspace memberships (admin only)
export const updateUserWorkspaces = async (userId, workspaceIds) => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);

  // Get current memberships
  const { data: current } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId);

  const currentIds = current?.map(m => m.workspace_id) || [];
  const toAdd = workspaceIds.filter(id => !currentIds.includes(id));
  const toRemove = currentIds.filter(id => !workspaceIds.includes(id));

  // Add new memberships
  if (toAdd.length > 0) {
    const { error: addError } = await supabase
      .from('workspace_members')
      .insert(toAdd.map(wsId => ({
        workspace_id: wsId,
        user_id: userId,
        added_by: user.id,
        created_at: now,
      })));
    if (addError) throw new Error(addError.message);
  }

  // Remove old memberships
  if (toRemove.length > 0) {
    const { error: removeError } = await supabase
      .from('workspace_members')
      .delete()
      .eq('user_id', userId)
      .in('workspace_id', toRemove);
    if (removeError) throw new Error(removeError.message);
  }

  return { success: true };
};

// ============================================
// WORKSPACES
// ============================================

// Get all workspaces the current user belongs to
export const getWorkspaces = async () => {
  const user = await checkAuth();

  // Check if user is system - they can see all workspaces
  const profile = await getUserProfile();
  if (profile?.role === 'system') {
    // System users get all workspaces directly
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, description, created_by, created_at, updated_at')
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  // Regular users get workspaces via membership
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      workspace:workspaces (
        id,
        name,
        description,
        created_by,
        created_at,
        updated_at
      )
    `)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);

  return data.map(wm => wm.workspace).filter(Boolean);
};

// Get all workspaces (admin only, for user management)
export const getAllWorkspaces = async () => {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
};

// Get a single workspace with member count
export const getWorkspace = async (id) => {
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);

  // Get member count
  const { count } = await supabase
    .from('workspace_members')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', id);

  return { ...workspace, member_count: count || 0 };
};

// Create a new workspace (admin only - via RPC to bypass RLS)
export const createWorkspace = async (name, description = '') => {
  const { data, error } = await supabase.rpc('create_workspace_rpc', {
    ws_name: name,
    ws_description: description || '',
  });

  if (error) throw new Error(error.message);
  if (!data.success) throw new Error(data.message);

  // The RPC function handles creating the workspace, adding creator as member,
  // and setting it as active workspace
  return data.workspace;
};

// Update workspace (admin only - RLS enforced)
export const updateWorkspace = async (id, updates) => {
  const { data, error } = await supabase
    .from('workspaces')
    .update({
      ...updates,
      updated_at: Math.floor(Date.now() / 1000),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
};

// Delete workspace (admin only - RLS enforced)
export const deleteWorkspace = async (id) => {
  const { error } = await supabase
    .from('workspaces')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
  return null;
};

// ============================================
// WORKSPACE MEMBERS
// ============================================

// Get members of a workspace (with their profiles) - for admin use
export const getWorkspaceMembers = async (workspaceId) => {
  const { data: memberships, error } = await supabase
    .from('workspace_members')
    .select('user_id, added_by, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  if (!memberships || memberships.length === 0) return [];

  const userIds = memberships.map(member => member.user_id);

  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('user_id, email, role, status, display_name, avatar_url, last_seen')
    .in('user_id', userIds);

  if (profilesError) throw new Error(profilesError.message);

  const profileMap = new Map((profiles || []).map(profile => [profile.user_id, profile]));

  return memberships.map(member => {
    const profile = profileMap.get(member.user_id);
    return {
      user_id: member.user_id,
      added_by: member.added_by,
      created_at: member.created_at,
      email: profile?.email || null,
      role: profile?.role || null,
      status: profile?.status || null,
      display_name: profile?.display_name || null,
      avatar_url: profile?.avatar_url || null,
      last_seen: profile?.last_seen || null,
    };
  });
};

// Get minimal workspace members info (for presence avatars - all users can access)
export const getWorkspaceMembersMinimal = async (workspaceId) => {
  const { data, error } = await supabase.rpc('get_workspace_members_minimal', {
    ws_id: workspaceId,
  });

  if (error) throw new Error(error.message);
  return data || [];
};

// Add existing user to workspace (admin only - via edge function)
export const addWorkspaceMember = async (workspaceId, email) => {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${PROXY_FUNCTION_URL.replace('/proxy', '/add-workspace-member')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ workspaceId, email }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to add member');
  }

  return result;
};

// Remove member from workspace (admin only)
export const removeWorkspaceMember = async (workspaceId, userId) => {
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return null;
};

// ============================================
// ACTIVE WORKSPACE
// ============================================

// Get user's active workspace
export const getActiveWorkspace = async () => {
  const user = await checkAuth();

  const { data, error } = await supabase
    .from('user_active_workspace')
    .select(`
      workspace_id,
      workspace:workspaces (
        id,
        name,
        description
      )
    `)
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') throw new Error(error.message);

  if (!data?.workspace) {
    // No active workspace set, return first workspace user belongs to
    const workspaces = await getWorkspaces();
    if (workspaces.length > 0) {
      await setActiveWorkspace(workspaces[0].id);
      return workspaces[0];
    }
    return null;
  }

  return data.workspace;
};

// Set user's active workspace
export const setActiveWorkspace = async (workspaceId) => {
  const user = await checkAuth();

  const { error } = await supabase
    .from('user_active_workspace')
    .upsert({
      user_id: user.id,
      workspace_id: workspaceId,
    }, {
      onConflict: 'user_id',
    });

  if (error) throw new Error(error.message);
  return { success: true };
};

// ============================================
// PERMISSION HELPERS
// ============================================

// Get current user's global role
export const getUserRole = async () => {
  const profile = await getUserProfile();
  return profile?.role || null;
};

// Check if current user can edit (developer or admin with active status)
export const canEdit = async () => {
  const profile = await getUserProfile();
  return profile?.status === 'active' && (profile?.role === 'developer' || profile?.role === 'admin');
};

// Check if current user is admin
export const isAdmin = async () => {
  const profile = await getUserProfile();
  return profile?.status === 'active' && profile?.role === 'admin';
};

// Check if current user is a member of a workspace
export const isMemberOf = async (workspaceId) => {
  const user = await checkAuth();

  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .single();

  if (error) return false;
  return !!data;
};

// ============================================
// WORKSPACE PRESENCE
// ============================================

let presenceChannel = null;
let presenceHeartbeatInterval = null;

// Update user's last_seen timestamp in database
export const updateLastSeen = async () => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);

  const { error } = await supabase
    .from('user_profiles')
    .update({ last_seen: now })
    .eq('user_id', user.id);

  if (error) {
    console.warn('Failed to update last_seen:', error.message);
  }
};

// Join workspace presence channel
export const joinWorkspacePresence = async (workspaceId, userInfo) => {
  const user = await checkAuth();

  // Leave existing channel if any
  if (presenceChannel) {
    await supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  // Clear any existing heartbeat
  if (presenceHeartbeatInterval) {
    clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = null;
  }

  // Create presence channel for this workspace
  const channelName = `workspace:${workspaceId}:presence`;

  presenceChannel = supabase.channel(channelName, {
    config: {
      presence: {
        key: user.id,
      },
    },
  });

  // Update last_seen immediately and start heartbeat (every 60 seconds)
  await updateLastSeen();
  presenceHeartbeatInterval = setInterval(updateLastSeen, 60000);

  return presenceChannel;
};

// Track user presence with state
export const trackPresence = async (state) => {
  if (!presenceChannel) return;

  await presenceChannel.track(state);
};

// Leave workspace presence channel
export const leaveWorkspacePresence = async () => {
  // Update last_seen one final time before leaving
  await updateLastSeen();

  // Clear heartbeat
  if (presenceHeartbeatInterval) {
    clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = null;
  }

  if (presenceChannel) {
    await presenceChannel.untrack();
    await supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }
};

// Get current presence channel (for subscribing to events)
export const getPresenceChannel = () => presenceChannel;

// ==================== User Config ====================

export const getUserConfig = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  const { data, error } = await supabase
    .from('user_config')
    .select('config')
    .eq('user_id', user.id)
    .single();

  if (error && error.code === 'PGRST116') return {}; // No row yet
  if (error) throw new Error(error.message);
  return data.config || {};
};

export const updateUserConfig = async (patch) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Read current config first
  const current = await getUserConfig();
  const merged = { ...current, ...patch };

  const { data, error } = await supabase
    .from('user_config')
    .upsert({
      user_id: user.id,
      config: merged,
      updated_at: Math.floor(Date.now() / 1000),
    }, { onConflict: 'user_id' })
    .select('config')
    .single();

  if (error) throw new Error(error.message);
  return data.config;
};

// ============================================
// COLLECTION VARIABLES
// ============================================

// Get a single collection with full details (for collection tab)
export const getCollection = async (id) => {
  const user = await checkAuth();

  const { data: collection, error } = await supabase
    .from('collections')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);

  // Get created_by user email
  let createdByEmail = null;
  if (collection.created_by) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('user_id', collection.created_by)
      .single();
    createdByEmail = profile?.email || null;
  }

  return {
    ...collection,
    created_by_email: createdByEmail,
  };
};

// Get collection variables with per-user current values
export const getCollectionVariables = async (collectionId) => {
  const user = await checkAuth();

  const { data: vars, error } = await supabase
    .from('collection_variables')
    .select('id, key, initial_value, enabled, sort_order')
    .eq('collection_id', collectionId)
    .order('sort_order');
  if (error) throw new Error(error.message);

  if (!vars || vars.length === 0) return [];

  const varIds = vars.map(v => v.id);
  let userValuesMap = {};

  if (varIds.length > 0) {
    const { data: userValues } = await supabase
      .from('collection_variable_user_values')
      .select('variable_id, current_value')
      .eq('user_id', user.id)
      .in('variable_id', varIds);

    (userValues || []).forEach(uv => {
      userValuesMap[uv.variable_id] = uv.current_value;
    });
  }

  return vars.map(v => {
    const current_value = userValuesMap[v.id] || '';
    return {
      id: v.id,
      key: v.key,
      initial_value: v.initial_value || '',
      current_value,
      value: current_value || v.initial_value || '',
      enabled: v.enabled !== false,
    };
  });
};

// Save collection variables (shared initial_value, like environment variables)
export const saveCollectionVariables = async (collectionId, variables) => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);

  // Get existing variables
  const { data: existingVars } = await supabase
    .from('collection_variables')
    .select('id, key')
    .eq('collection_id', collectionId);

  const existingVarsMap = new Map((existingVars || []).map(v => [v.key, v.id]));
  const updatedKeys = new Set(variables.filter(v => v.key).map(v => v.key));

  // Delete removed variables
  const varsToDelete = (existingVars || []).filter(v => !updatedKeys.has(v.key));
  if (varsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('collection_variables')
      .delete()
      .in('id', varsToDelete.map(v => v.id));
    if (deleteError) throw new Error(deleteError.message);
  }

  // Update existing variables (initial_value, enabled, sort_order)
  for (let i = 0; i < variables.length; i++) {
    const v = variables[i];
    if (!v.key) continue;
    const existingId = existingVarsMap.get(v.key);
    if (existingId) {
      const { error } = await supabase
        .from('collection_variables')
        .update({
          initial_value: v.initial_value ?? '',
          enabled: v.enabled !== false,
          sort_order: i,
          updated_at: now,
        })
        .eq('id', existingId);
      if (error) throw new Error(error.message);
    }
  }

  // Insert new variables
  const newVars = variables.filter(v => v.key && !existingVarsMap.has(v.key));
  if (newVars.length > 0) {
    const maxOrder = variables.length - newVars.length;
    const varsToInsert = newVars.map((v, index) => ({
      id: crypto.randomUUID(),
      collection_id: collectionId,
      key: v.key,
      initial_value: v.initial_value ?? '',
      enabled: v.enabled !== false,
      sort_order: maxOrder + index,
      created_at: now,
      updated_at: now,
    }));

    const { error: insertError } = await supabase
      .from('collection_variables')
      .insert(varsToInsert);
    if (insertError) throw new Error(insertError.message);
  }

  // Update collection's updated_at
  await supabase
    .from('collections')
    .update({ updated_at: now })
    .eq('id', collectionId);

  // Return fresh variables
  return getCollectionVariables(collectionId);
};

// Update user's current values for collection variables (private)
export const updateCollectionVariableCurrentValues = async (collectionId, currentValues) => {
  const user = await checkAuth();

  // Get variables for this collection to map keys to IDs
  const { data: vars } = await supabase
    .from('collection_variables')
    .select('id, key')
    .eq('collection_id', collectionId);

  const keyToId = {};
  (vars || []).forEach(v => {
    keyToId[v.key] = v.id;
  });

  const entries = Object.entries(currentValues);

  for (const [keyOrId, currentValue] of entries) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keyOrId);
    const variableId = isUuid ? keyOrId : keyToId[keyOrId];
    if (!variableId) continue;

    if (currentValue === null || currentValue === undefined || currentValue === '') {
      await supabase
        .from('collection_variable_user_values')
        .delete()
        .eq('variable_id', variableId)
        .eq('user_id', user.id);
    } else {
      const { error } = await supabase
        .from('collection_variable_user_values')
        .upsert({
          variable_id: variableId,
          user_id: user.id,
          current_value: currentValue,
        }, {
          onConflict: 'variable_id,user_id',
        });
      if (error) throw new Error(error.message);
    }
  }

  return { success: true };
};

// Get deep request count for a collection (including all descendants)
export const getCollectionRequestCount = async (collectionId) => {
  // Get all descendant collection IDs
  let allIds = [collectionId];
  const fetchChildren = async (parentIds) => {
    if (parentIds.length === 0) return;
    const { data: children } = await supabase
      .from('collections')
      .select('id')
      .in('parent_id', parentIds);
    if (children && children.length > 0) {
      const childIds = children.map(c => c.id);
      allIds = [...allIds, ...childIds];
      await fetchChildren(childIds);
    }
  };
  await fetchChildren([collectionId]);

  // Count requests across all collections
  let total = 0;
  for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
    const batch = allIds.slice(i, i + BATCH_SIZE);
    const { count, error } = await supabase
      .from('requests')
      .select('*', { count: 'exact', head: true })
      .in('collection_id', batch);
    if (!error) total += count || 0;
  }

  return total;
};

// Provider info
export const providerName = 'supabase';
export const supportsRealtime = true;
export const supportsMagicLink = true;
export const supportsWorkspaces = true;
export const supportsPresence = true;
