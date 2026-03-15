import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export function registerEnvironmentLookupTools(server: McpServer, getClient: () => SupabaseClient) {
  server.tool(
    'list_workspace_environments',
    'List available environments in a workspace, including variables with current user values merged over initial values.',
    {
      workspace_id: z.string().uuid().describe('Workspace ID'),
    },
    async ({ workspace_id }) => {
      const supabase = getClient();

      const { data: environments, error: envError } = await supabase
        .from('environments')
        .select(`
          id,
          name,
          workspace_id,
          created_at,
          updated_at,
          environment_variables (
            id,
            key,
            initial_value,
            enabled,
            sort_order
          )
        `)
        .eq('workspace_id', workspace_id)
        .order('name', { ascending: true });

      if (envError) {
        return { content: [{ type: 'text' as const, text: `Error: ${envError.message}` }], isError: true };
      }

      if (!environments || environments.length === 0) {
        return { content: [{ type: 'text' as const, text: '[]' }] };
      }

      const allVariableIds = environments.flatMap((env: any) =>
        (env.environment_variables || []).map((variable: any) => variable.id)
      );

      let userValuesByVariableId: Record<string, string> = {};
      if (allVariableIds.length > 0) {
        const { data: userValues, error: userValuesError } = await supabase
          .from('environment_user_values')
          .select('variable_id, current_value')
          .in('variable_id', allVariableIds);

        if (userValuesError) {
          return { content: [{ type: 'text' as const, text: `Error: ${userValuesError.message}` }], isError: true };
        }

        for (const value of userValues || []) {
          userValuesByVariableId[value.variable_id] = value.current_value;
        }
      }

      const result = environments.map((env: any) => ({
        id: env.id,
        name: env.name,
        workspace_id: env.workspace_id,
        created_at: env.created_at,
        updated_at: env.updated_at,
        variables: (env.environment_variables || [])
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((variable: any) => {
            const currentValue = userValuesByVariableId[variable.id] || '';
            return {
              id: variable.id,
              key: variable.key,
              initial_value: variable.initial_value || '',
              current_value: currentValue,
              value: currentValue || variable.initial_value || '',
              enabled: variable.enabled !== false,
            };
          }),
      }));

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
