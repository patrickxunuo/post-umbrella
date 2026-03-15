import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function registerExampleTools(server: McpServer, getClient: () => SupabaseClient) {
  server.tool(
    'list_examples',
    'List saved request/response examples for a request',
    { request_id: z.string().uuid().describe('Request ID') },
    async ({ request_id }) => {
      const supabase = getClient();
      const { data, error } = await supabase
        .from('examples')
        .select('id, name, request_id, created_at, updated_at')
        .eq('request_id', request_id)
        .order('created_at', { ascending: false });
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_example',
    'Get a saved example with full request and response data',
    { example_id: z.string().uuid().describe('Example ID') },
    async ({ example_id }) => {
      const supabase = getClient();
      const { data, error } = await supabase.from('examples').select('*').eq('id', example_id).single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_example',
    'Save a request/response pair as an example',
    {
      request_id: z.string().uuid().describe('Request ID'),
      name: z.string().describe('Example name'),
      request_data: z.string().describe('JSON string of request data (method, url, headers, body)'),
      response_data: z.string().describe('JSON string of response data (status, headers, body)'),
    },
    async ({ request_id, name, request_data, response_data }) => {
      const supabase = getClient();
      const { data, error } = await supabase
        .from('examples')
        .insert({ request_id, name, request_data, response_data })
        .select()
        .single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_example',
    'Update a saved example',
    {
      example_id: z.string().uuid().describe('Example ID'),
      name: z.string().optional().describe('New name'),
      request_data: z.string().optional().describe('Updated request data JSON'),
      response_data: z.string().optional().describe('Updated response data JSON'),
    },
    async ({ example_id, ...updates }) => {
      const supabase = getClient();
      const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(filtered).length === 0) {
        return { content: [{ type: 'text' as const, text: 'No fields to update.' }] };
      }
      const { data, error } = await supabase.from('examples').update(filtered).eq('id', example_id).select().single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_example',
    'Delete a saved example',
    { example_id: z.string().uuid().describe('Example ID') },
    async ({ example_id }) => {
      const supabase = getClient();
      const { error } = await supabase.from('examples').delete().eq('id', example_id);
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: `Example ${example_id} deleted.` }] };
    }
  );
}
