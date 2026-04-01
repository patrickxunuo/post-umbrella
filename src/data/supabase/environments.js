// Environment CRUD
import { supabase } from './client.js';
import { checkAuth, batchedIn, BATCH_SIZE } from './helpers.js';

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


