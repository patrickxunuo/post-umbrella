// Request CRUD
import { supabase } from './client.js';

// Requests
// Helper to parse request JSON fields
const parseRequest = (request) => ({
  ...request,
  headers: typeof request.headers === 'string' ? JSON.parse(request.headers || '[]') : (request.headers || []),
  params: typeof request.params === 'string' ? JSON.parse(request.params || '[]') : (request.params || []),
  form_data: typeof request.form_data === 'string' ? JSON.parse(request.form_data || '[]') : (request.form_data || []),
  path_variables: typeof request.path_variables === 'string'
    ? JSON.parse(request.path_variables || '[]')
    : (request.path_variables || []),
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
      path_variables: request.path_variables ? JSON.stringify(request.path_variables) : '[]',
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
  if (updates.path_variables !== undefined) updateData.path_variables = JSON.stringify(updates.path_variables);
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


