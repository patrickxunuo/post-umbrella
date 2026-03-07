// Supabase Data Provider
import { supabase, PROXY_FUNCTION_URL } from './client.js';

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

// Auth - Magic Link (email only)
export const sendMagicLink = async (email) => {
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw new Error(error.message);
  return { message: 'Check your email for the magic link!' };
};

// Auth - Bitbucket OAuth
export const signInWithBitbucket = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'bitbucket',
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) throw new Error(error.message);
  return data;
};

export const verifyMagicLink = async (token) => {
  // This is handled automatically by Supabase when user clicks the link
  // The detectSessionInUrl option handles the token exchange
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!session) throw new Error('No session found');

  currentUser = {
    id: session.user.id,
    email: session.user.email,
  };
  setCurrentUser(currentUser);
  return { user: currentUser };
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
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!session) throw new Error('Not authenticated');

  currentUser = {
    id: session.user.id,
    email: session.user.email,
  };
  return currentUser;
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
      .in('parent_id', parentIds);
    if (error) throw new Error(error.message);
    if (children && children.length > 0) {
      allCollections = [...allCollections, ...children];
      await fetchChildren(children.map(c => c.id));
    }
  };
  await fetchChildren(topLevelIds);

  // Fetch all requests for these collections
  const allCollectionIds = allCollections.map(c => c.id);
  let reqQuery = supabase.from('requests').select('*');
  if (allCollectionIds.length > 0) {
    reqQuery = reqQuery.in('collection_id', allCollectionIds);
  }
  const { data: requests, error: reqError } = await reqQuery
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (reqError) throw new Error(reqError.message);

  // Get example counts for all requests
  const requestIds = requests?.map(r => r.id) || [];
  let exampleCounts = [];
  if (requestIds.length > 0) {
    const { data: counts, error: exError } = await supabase
      .from('examples')
      .select('request_id')
      .in('request_id', requestIds);
    if (exError) throw new Error(exError.message);
    exampleCounts = counts || [];
  }

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
  // Update sort_order for each request
  const updates = requestIds.map((id, index) => ({
    id,
    sort_order: index,
  }));

  for (const update of updates) {
    const { error } = await supabase
      .from('requests')
      .update({ sort_order: update.sort_order })
      .eq('id', update.id);
    if (error) throw new Error(error.message);
  }

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
  const { data, error } = await query.order('created_at', { ascending: false });
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
export const getEnvironments = async (collectionId) => {
  const user = await checkAuth();

  const { data: environments, error: envError } = await supabase
    .from('environments')
    .select('*')
    .eq('collection_id', collectionId)
    .order('name', { ascending: true });
  if (envError) throw new Error(envError.message);

  // Get active environment for this user and collection
  const { data: activeEnv, error: activeError } = await supabase
    .from('user_active_environment')
    .select('environment_id')
    .eq('user_id', user.id)
    .eq('collection_id', collectionId)
    .single();

  const activeEnvId = activeEnv?.environment_id;

  return environments.map(env => ({
    ...env,
    variables: typeof env.variables === 'string' ? JSON.parse(env.variables || '[]') : (env.variables || []),
    is_active: env.id === activeEnvId,
  }));
};

export const getActiveEnvironment = async (collectionId) => {
  const user = await checkAuth();

  const { data: activeEnv } = await supabase
    .from('user_active_environment')
    .select('environment_id')
    .eq('user_id', user.id)
    .eq('collection_id', collectionId)
    .single();

  if (!activeEnv?.environment_id) return null;

  const { data: env, error } = await supabase
    .from('environments')
    .select('*')
    .eq('id', activeEnv.environment_id)
    .single();

  if (error) return null;
  return {
    ...env,
    variables: typeof env.variables === 'string' ? JSON.parse(env.variables || '[]') : (env.variables || []),
    is_active: true,
  };
};

export const createEnvironment = async (environment) => {
  const user = await checkAuth();
  const now = Math.floor(Date.now() / 1000);

  const { data, error } = await supabase
    .from('environments')
    .insert({
      id: crypto.randomUUID(),
      name: environment.name,
      variables: JSON.stringify(environment.variables || []),
      collection_id: environment.collection_id,
      created_by: user.id,
      updated_by: user.id,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    ...data,
    variables: typeof data.variables === 'string' ? JSON.parse(data.variables || '[]') : (data.variables || []),
  };
};

export const updateEnvironment = async (id, updates) => {
  const user = await checkAuth();

  const updateData = {
    updated_by: user.id,
    updated_at: Math.floor(Date.now() / 1000),
  };
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.variables !== undefined) updateData.variables = JSON.stringify(updates.variables);

  const { data, error } = await supabase
    .from('environments')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    ...data,
    variables: typeof data.variables === 'string' ? JSON.parse(data.variables || '[]') : (data.variables || []),
  };
};

export const activateEnvironment = async (id) => {
  const user = await checkAuth();

  // Get the environment to find its collection_id
  const { data: env, error: envError } = await supabase
    .from('environments')
    .select('collection_id')
    .eq('id', id)
    .single();
  if (envError) throw new Error(envError.message);

  // Upsert the active environment
  const { error } = await supabase
    .from('user_active_environment')
    .upsert({
      user_id: user.id,
      collection_id: env.collection_id,
      environment_id: id,
    }, {
      onConflict: 'user_id,collection_id',
    });
  if (error) throw new Error(error.message);

  return { success: true };
};

export const deactivateEnvironments = async (collectionId) => {
  const user = await checkAuth();

  const { error } = await supabase
    .from('user_active_environment')
    .delete()
    .eq('user_id', user.id)
    .eq('collection_id', collectionId);
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
export const sendRequest = async (data) => {
  // Check if localhost - send directly from browser
  const isLocalhost = (url) => {
    try {
      let urlToParse = url;
      if (!url.match(/^https?:\/\//i)) {
        urlToParse = 'http://' + url;
      }
      const parsed = new URL(urlToParse);
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch (e) {
      return false;
    }
  };

  if (isLocalhost(data.url)) {
    return sendDirectRequest(data);
  }

  // Send via Edge Function proxy
  const response = await fetch(PROXY_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Proxy request failed');
  }

  return response.json();
};

// Direct request for localhost
const sendDirectRequest = async (data) => {
  const { method, headers, body, bodyType, formData, timeout } = data;
  let url = data.url;
  if (!url.match(/^https?:\/\//i)) {
    url = 'http://' + url;
  }
  const startTime = Date.now();

  try {
    const headersObj = {};
    if (Array.isArray(headers)) {
      headers.forEach(h => {
        if (h.key && h.enabled !== false) {
          headersObj[h.key] = h.value;
        }
      });
    }

    const config = {
      method: method || 'GET',
      headers: headersObj,
    };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase())) {
      if (bodyType === 'form-data' && Array.isArray(formData)) {
        const form = new FormData();
        for (const field of formData) {
          if (!field.key || field.enabled === false) continue;
          if (field.type === 'file' && field.fileData) {
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
        config.body = form;
      } else if (body) {
        config.body = body;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout || 30000);
    config.signal = controller.signal;

    const response = await fetch(url, config);
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
    response.headers.forEach((value, key) => {
      responseHeaders.push({ key, value });
    });

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

    if (error.name === 'AbortError') {
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
      body: error.message,
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

export const exportCollections = async () => {
  const allCollections = await getCollections();
  const allRequests = await getRequests();
  const allExamples = await getExamples();

  // Build Postman collection for each top-level collection
  const postmanCollections = allCollections
    .filter(c => !c.parent_id)
    .map(collection => buildPostmanCollection(collection, allCollections, allRequests, allExamples));

  // If single collection, return it directly; otherwise wrap in array
  if (postmanCollections.length === 1) {
    return postmanCollections[0];
  }
  return postmanCollections;
};

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
  const user = await checkAuth();

  if (!postmanData || !postmanData.info) {
    throw new Error('Invalid Postman collection format');
  }

  const collectionName = postmanData.info?.name || 'Imported Collection';

  // Check if collection with this name already exists
  const { data: existing } = await supabase
    .from('collections')
    .select('id')
    .eq('name', collectionName)
    .is('parent_id', null)
    .single();

  if (existing) {
    throw new Error(`A collection named "${collectionName}" already exists. Please rename or delete the existing collection before importing.`);
  }

  // Import the collection recursively
  const result = await importPostmanCollection(postmanData, null, workspaceId);

  // Import environment variables if present
  let environment = null;
  if (postmanData.variable && postmanData.variable.length > 0 && result.collections.length > 0) {
    const rootCollectionId = result.collections[0].id;
    environment = await importEnvironmentVariables(postmanData, user.id, rootCollectionId);
  }

  return { success: true, ...result, environment };
};

// Helper: Import Postman collection recursively
async function importPostmanCollection(postmanData, parentId, workspaceId = null) {
  const collectionId = crypto.randomUUID();
  const collectionName = postmanData.info?.name || 'Imported Collection';
  const now = Math.floor(Date.now() / 1000);

  // Only root collections get workspace_id (children inherit via parent_id)
  const insertData = {
    id: collectionId,
    name: collectionName,
    parent_id: parentId,
    created_at: now,
    updated_at: now,
  };
  if (!parentId && workspaceId) {
    insertData.workspace_id = workspaceId;
  }

  const { error: collError } = await supabase
    .from('collections')
    .insert(insertData);

  if (collError) throw new Error(collError.message);

  const result = {
    collections: [{ id: collectionId, name: collectionName }],
    requests: [],
  };

  if (postmanData.item) {
    for (const item of postmanData.item) {
      if (item.request) {
        const req = await importPostmanRequest(item, collectionId);
        result.requests.push(req);
      } else if (item.item) {
        // Child collections don't need workspace_id (inherited via parent)
        const subResult = await importPostmanCollection(
          { info: { name: item.name }, item: item.item },
          collectionId,
          null
        );
        result.collections.push(...subResult.collections);
        result.requests.push(...subResult.requests);
      }
    }
  }

  return result;
}

// Helper: Import single request
async function importPostmanRequest(item, collectionId) {
  const requestId = crypto.randomUUID();
  const req = item.request;
  const now = Math.floor(Date.now() / 1000);

  const headers = (req.header || []).map(h => ({
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }));

  let url = '';
  if (typeof req.url === 'string') {
    url = req.url;
  } else if (req.url?.raw) {
    url = req.url.raw;
  }

  let body = '';
  let bodyType = 'none';
  if (req.body) {
    bodyType = req.body.mode || 'raw';
    if (bodyType === 'raw') {
      body = req.body.raw || '';
      if (req.body.options?.raw?.language === 'json') {
        bodyType = 'json';
      }
    }
  }

  const { error: reqError } = await supabase
    .from('requests')
    .insert({
      id: requestId,
      collection_id: collectionId,
      name: item.name,
      method: req.method || 'GET',
      url,
      headers: JSON.stringify(headers),
      body,
      body_type: bodyType,
      created_at: now,
      updated_at: now,
    });

  if (reqError) throw new Error(reqError.message);

  // Import examples (saved responses)
  if (item.response && item.response.length > 0) {
    for (const resp of item.response) {
      await importPostmanExample(resp, requestId);
    }
  }

  return { id: requestId, name: item.name };
}

// Helper: Import example
async function importPostmanExample(resp, requestId) {
  const exampleId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const requestData = {
    method: resp.originalRequest?.method || 'GET',
    url: resp.originalRequest?.url?.raw || '',
    headers: (resp.originalRequest?.header || []).map(h => ({
      key: h.key,
      value: h.value,
      enabled: true,
    })),
    body: resp.originalRequest?.body?.raw || '',
  };

  const responseData = {
    status: resp.code || 200,
    statusText: resp.status || 'OK',
    headers: (resp.header || []).map(h => ({
      key: h.key,
      value: h.value,
    })),
    body: resp.body || '',
  };

  const { error } = await supabase
    .from('examples')
    .insert({
      id: exampleId,
      request_id: requestId,
      name: resp.name || 'Example',
      request_data: JSON.stringify(requestData),
      response_data: JSON.stringify(responseData),
      created_at: now,
    });

  if (error) throw new Error(error.message);
}

// Helper: Import environment variables
async function importEnvironmentVariables(postmanData, userId, collectionId) {
  const variables = postmanData.variable || [];
  if (variables.length === 0) return null;

  const envId = crypto.randomUUID();
  const envName = `${postmanData.info?.name || 'Imported'} Variables`;
  const now = Math.floor(Date.now() / 1000);

  const envVariables = variables.map(v => ({
    key: v.key,
    value: v.value || '',
    enabled: !v.disabled,
  }));

  const { error } = await supabase
    .from('environments')
    .insert({
      id: envId,
      name: envName,
      variables: JSON.stringify(envVariables),
      collection_id: collectionId,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    });

  if (error) throw new Error(error.message);

  return { id: envId, name: envName, variables: envVariables, collection_id: collectionId };
}

// Realtime subscriptions
let realtimeChannel = null;

export const subscribeToChanges = (callback, workspaceId = null) => {
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
      (payload) => callback({ type: `collection:${payload.eventType}`, data: payload.new || payload.old })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'requests' },
      (payload) => callback({ type: `request:${payload.eventType}`, data: payload.new || payload.old })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'examples' },
      (payload) => callback({ type: `example:${payload.eventType}`, data: payload.new || payload.old })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'environments' },
      (payload) => callback({ type: `environment:${payload.eventType}`, data: payload.new || payload.old })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'workspaces' },
      (payload) => callback({ type: `workspace:${payload.eventType}`, data: payload.new || payload.old })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'workspace_members' },
      (payload) => callback({ type: `workspace_member:${payload.eventType}`, data: payload.new || payload.old })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_profiles' },
      (payload) => callback({ type: `user_profile:${payload.eventType}`, data: payload.new || payload.old })
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

  console.log('getUserProfile for user:', user.id);

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

// Get members of a workspace (with their profiles)
export const getWorkspaceMembers = async (workspaceId) => {
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      user_id,
      added_by,
      created_at,
      profile:user_profiles (
        role,
        status
      )
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return data.map(m => ({
    user_id: m.user_id,
    added_by: m.added_by,
    created_at: m.created_at,
    role: m.profile?.role,
    status: m.profile?.status,
  }));
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

// Provider info
export const providerName = 'supabase';
export const supportsRealtime = true;
export const supportsMagicLink = true;
export const supportsWorkspaces = true;
