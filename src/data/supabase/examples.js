// Example CRUD
import { supabase } from './client.js';

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


