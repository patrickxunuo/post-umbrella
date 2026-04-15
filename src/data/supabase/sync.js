// Import/Export + Realtime subscriptions
import { supabase } from './client.js';
import { checkAuth } from './helpers.js';
import { getCollections } from './collections.js';
import { getRequests } from './requests.js';
import { getExamples } from './examples.js';
import { getCollectionVariables } from './collectionVars.js';

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

// Build a Postman-shaped `auth` object from our auth_type / auth_token.
// Returns `undefined` to signal "omit the field" (our "inherit" maps to omission),
// `null` to signal an explicit noauth override when a parent has auth.
function buildPostmanAuth(authType, authToken, parentAuth) {
  if (authType === 'bearer' && authToken) {
    return { type: 'bearer', bearer: [{ key: 'token', value: authToken, type: 'string' }] };
  }
  if (authType === 'none' && parentAuth) {
    return { type: 'noauth' };
  }
  // 'inherit' or 'none' with no parent auth → omit entirely
  return undefined;
}

function buildPostmanEvents(preScript, postScript) {
  const event = [];
  if (preScript) {
    event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: preScript.split('\n') } });
  }
  if (postScript) {
    event.push({ listen: 'test', script: { type: 'text/javascript', exec: postScript.split('\n') } });
  }
  return event;
}

// Helper: Build Postman request format
function buildPostmanRequest(req, examples, parentAuth) {
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

  const auth = buildPostmanAuth(req.auth_type, req.auth_token, parentAuth);
  if (auth !== undefined) request.auth = auth;

  const item = {
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

  const event = buildPostmanEvents(req.pre_script, req.post_script);
  if (event.length > 0) item.event = event;

  return item;
}

// Helper: Build Postman Collection v2.1 format.
// `allVariables` is the root collection's variables (only emitted on the root).
// `parentAuth` threads the effective auth down so nested items can decide
// whether emitting `{ type: 'noauth' }` is meaningful.
function buildPostmanCollection(collection, allCollections, allRequests, allExamples, allVariables, parentAuth = null) {
  const myAuth = buildPostmanAuth(collection.auth_type, collection.auth_token, parentAuth);
  // effectiveAuth threaded to children: bearer on this level wins; an explicit
  // 'none' override clears inherited auth; otherwise children keep inheriting.
  let effectiveAuth;
  if (collection.auth_type === 'bearer' && collection.auth_token) {
    effectiveAuth = { type: 'bearer', bearer: [{ key: 'token', value: collection.auth_token, type: 'string' }] };
  } else if (collection.auth_type === 'none') {
    effectiveAuth = null;
  } else {
    effectiveAuth = parentAuth;
  }

  const collectionRequests = allRequests.filter(r => r.collection_id === collection.id);
  const childCollections = allCollections.filter(c => c.parent_id === collection.id);

  const items = [
    ...collectionRequests.map(req => {
      const reqExamples = allExamples.filter(e => e.request_id === req.id);
      return buildPostmanRequest(req, reqExamples, effectiveAuth);
    }),
    ...childCollections.map(child => {
      const inner = buildPostmanCollection(child, allCollections, allRequests, allExamples, allVariables, effectiveAuth);
      const folder = { name: child.name, item: inner.item };
      if (inner.auth) folder.auth = inner.auth;
      if (inner.event) folder.event = inner.event;
      return folder;
    }),
  ];

  const isRoot = !collection.parent_id;
  const result = isRoot
    ? {
        info: {
          _postman_id: collection.id,
          name: collection.name,
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: items,
      }
    : { item: items };

  if (myAuth !== undefined) result.auth = myAuth;

  const event = buildPostmanEvents(collection.pre_script, collection.post_script);
  if (event.length > 0) result.event = event;

  if (isRoot && Array.isArray(allVariables) && allVariables.length > 0) {
    const vars = allVariables
      .filter(v => v.enabled !== false && v.key)
      .map(v => ({ key: v.key, value: v.value || v.initial_value || '', type: 'string' }));
    if (vars.length > 0) result.variable = vars;
  }

  return result;
}

export const exportCollection = async (id) => {
  const allCollections = await getCollections();
  const allRequests = await getRequests();
  const allExamples = await getExamples();

  const rootCollection = allCollections.find(c => c.id === id);
  if (!rootCollection) {
    throw new Error('Collection not found');
  }

  let allVariables = [];
  try {
    allVariables = await getCollectionVariables(id);
  } catch {
    // Non-fatal — export without variables rather than aborting
    allVariables = [];
  }

  return buildPostmanCollection(rootCollection, allCollections, allRequests, allExamples, allVariables);
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
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'workflows' },
      (payload) => callback({ type: `workflow:${payload.eventType}`, data: getRealtimeData(payload) })
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


