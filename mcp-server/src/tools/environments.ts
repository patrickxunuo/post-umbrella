import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function registerEnvironmentTools(server: McpServer, getClient: () => SupabaseClient) {
  server.tool(
    'list_environments',
    'List environments in a workspace',
    { workspace_id: z.string().uuid().describe('Workspace ID') },
    async ({ workspace_id }) => {
      const supabase = getClient();
      const { data, error } = await supabase
        .from('environments')
        .select('id, name, workspace_id, created_by, updated_by, created_at, updated_at')
        .eq('workspace_id', workspace_id)
        .order('name');
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_environment',
    'Get environment details with all variables (initial values and your current values)',
    { environment_id: z.string().uuid().describe('Environment ID') },
    async ({ environment_id }) => {
      const supabase = getClient();

      const [envResult, varsResult] = await Promise.all([
        supabase.from('environments').select('*').eq('id', environment_id).single(),
        supabase.from('environment_variables')
          .select('id, key, initial_value, enabled, sort_order, environment_user_values(current_value)')
          .eq('environment_id', environment_id)
          .order('sort_order'),
      ]);

      if (envResult.error) return { content: [{ type: 'text' as const, text: `Error: ${envResult.error.message}` }], isError: true };

      const variables = (varsResult.data || []).map((v: any) => ({
        id: v.id,
        key: v.key,
        initial_value: v.initial_value,
        current_value: v.environment_user_values?.[0]?.current_value ?? v.initial_value,
        enabled: v.enabled,
        sort_order: v.sort_order,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ...envResult.data, variables }, null, 2) }],
      };
    }
  );

  server.tool(
    'create_environment',
    'Create a new environment in a workspace with optional initial variables',
    {
      workspace_id: z.string().uuid().describe('Workspace ID'),
      name: z.string().describe('Environment name'),
      variables: z.array(z.object({
        key: z.string(),
        initial_value: z.string().default(''),
        enabled: z.boolean().default(true),
      })).optional().describe('Initial variables'),
    },
    async ({ workspace_id, name, variables }) => {
      const supabase = getClient();
      const { data: env, error } = await supabase
        .from('environments')
        .insert({ name, workspace_id })
        .select()
        .single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };

      if (variables?.length) {
        const varInserts = variables.map((v, i) => ({
          environment_id: env.id,
          key: v.key,
          initial_value: v.initial_value,
          enabled: v.enabled,
          sort_order: i,
        }));
        await supabase.from('environment_variables').insert(varInserts);
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(env, null, 2) }] };
    }
  );

  server.tool(
    'update_environment',
    'Update environment name',
    {
      environment_id: z.string().uuid().describe('Environment ID'),
      name: z.string().describe('New name'),
    },
    async ({ environment_id, name }) => {
      const supabase = getClient();
      const { data, error } = await supabase.from('environments').update({ name }).eq('id', environment_id).select().single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_environment',
    'Delete an environment and all its variables',
    { environment_id: z.string().uuid().describe('Environment ID') },
    async ({ environment_id }) => {
      const supabase = getClient();
      const { error } = await supabase.from('environments').delete().eq('id', environment_id);
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: `Environment ${environment_id} deleted.` }] };
    }
  );

  server.tool(
    'set_active_environment',
    'Set the active environment for a workspace (affects variable substitution)',
    {
      workspace_id: z.string().uuid().describe('Workspace ID'),
      environment_id: z.string().uuid().describe('Environment ID to activate'),
    },
    async ({ workspace_id, environment_id }) => {
      const supabase = getClient();
      const { error } = await supabase
        .from('user_active_environment')
        .upsert({ workspace_id, environment_id }, { onConflict: 'user_id,workspace_id' });
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: `Environment ${environment_id} activated for workspace ${workspace_id}.` }] };
    }
  );
}
