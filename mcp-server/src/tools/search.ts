import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export function registerSearchTools(server: McpServer, getClient: () => SupabaseClient) {
  server.tool(
    'search_apis_by_name',
    'Search requests by name across only the workspaces and folders the current user can view.',
    {
      query: z.string().min(1).describe('Partial API/request name to search for'),
      limit: z.number().int().min(1).max(100).default(25).describe('Maximum number of results to return'),
    },
    async ({ query, limit }) => {
      const supabase = getClient();
      const pattern = `%${query.trim()}%`;

      const { data, error } = await supabase
        .from('requests')
        .select(`
          id,
          name,
          method,
          url,
          updated_at,
          collection:collections!inner(
            id,
            name,
            workspace_id,
            workspace:workspaces!inner(
              id,
              name
            )
          )
        `)
        .ilike('name', pattern)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      }

      const results = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        method: row.method,
        url: row.url,
        updated_at: row.updated_at,
        folder: row.collection ? {
          id: row.collection.id,
          name: row.collection.name,
        } : null,
        workspace: row.collection?.workspace ? {
          id: row.collection.workspace.id,
          name: row.collection.workspace.name,
        } : null,
      }));

      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );
}
