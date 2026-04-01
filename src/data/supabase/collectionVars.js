// Collection variables + collection details
import { supabase } from './client.js';
import { checkAuth, BATCH_SIZE } from './helpers.js';

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


