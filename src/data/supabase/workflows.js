// Workflow CRUD
import { supabase } from './client.js';
import { checkAuth } from './helpers.js';

// ========== Workflows ==========

export const getWorkflows = async (collectionId) => {
  const query = supabase.from('workflows').select('*').order('created_at', { ascending: true });
  if (collectionId) query.eq('collection_id', collectionId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(w => ({
    ...w,
    steps: typeof w.steps === 'string' ? JSON.parse(w.steps) : (w.steps || []),
  }));
};

export const getWorkflow = async (id) => {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return {
    ...data,
    steps: typeof data.steps === 'string' ? JSON.parse(data.steps) : (data.steps || []),
  };
};

export const createWorkflow = async (workflow) => {
  const user = await checkAuth();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const { data, error } = await supabase
    .from('workflows')
    .insert({
      id,
      collection_id: workflow.collection_id,
      created_by: user.id,
      name: workflow.name || 'New Workflow',
      steps: workflow.steps || [],
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    ...data,
    steps: typeof data.steps === 'string' ? JSON.parse(data.steps) : (data.steps || []),
  };
};

export const updateWorkflow = async (id, updates) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = { updated_at: now };
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.steps !== undefined) payload.steps = updates.steps;
  const { data, error } = await supabase
    .from('workflows')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    ...data,
    steps: typeof data.steps === 'string' ? JSON.parse(data.steps) : (data.steps || []),
  };
};

export const deleteWorkflow = async (id) => {
  const { error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
  return null;
};

// Provider info
export const providerName = 'supabase';
export const supportsRealtime = true;
export const supportsMagicLink = true;
export const supportsWorkspaces = true;
export const supportsPresence = true;

