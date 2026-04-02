// Import/Export + Realtime subscriptions
import { supabase } from './client.js';
import { checkAuth } from './helpers.js';

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


