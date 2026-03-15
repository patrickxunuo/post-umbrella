import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function registerWorkspaceTools(server: McpServer, getClient: () => SupabaseClient) {
  server.tool(
    'list_workspaces',
    'List all workspaces you have access to',
    {},
    async () => {
      const supabase = getClient();
      const { data, error } = await supabase.from('workspaces').select('id, name, description, created_at');
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_workspace',
    'Get workspace details including member count',
    { workspace_id: z.string().uuid().describe('Workspace ID') },
    async ({ workspace_id }) => {
      const supabase = getClient();
      const [wsResult, membersResult] = await Promise.all([
        supabase.from('workspaces').select('*').eq('id', workspace_id).single(),
        supabase.from('workspace_members').select('user_id', { count: 'exact' }).eq('workspace_id', workspace_id),
      ]);
      if (wsResult.error) return { content: [{ type: 'text' as const, text: `Error: ${wsResult.error.message}` }], isError: true };
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ...wsResult.data, member_count: membersResult.count || 0 }, null, 2),
        }],
      };
    }
  );
}
