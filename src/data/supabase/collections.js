// Collection CRUD
import { supabase } from './client.js';
import { BATCH_SIZE, batchedIn } from './helpers.js';

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

