import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function registerRequestTools(server: McpServer, getClient: () => SupabaseClient) {
  server.tool(
    'list_requests',
    'List all requests in a collection',
    { collection_id: z.string().uuid().describe('Collection ID') },
    async ({ collection_id }) => {
      const supabase = getClient();
      const { data, error } = await supabase
        .from('requests')
        .select('id, name, method, url, collection_id, sort_order, created_at, updated_at')
        .eq('collection_id', collection_id)
        .order('sort_order');
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_request',
    'Get full details of an HTTP request (method, URL, headers, body, params, auth, scripts)',
    { request_id: z.string().uuid().describe('Request ID') },
    async ({ request_id }) => {
      const supabase = getClient();
      const { data, error } = await supabase.from('requests').select('*').eq('id', request_id).single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_request',
    'Create a new HTTP request in a collection',
    {
      collection_id: z.string().uuid().describe('Collection ID'),
      name: z.string().describe('Request name'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET').describe('HTTP method'),
      url: z.string().default('').describe('Request URL (can use {{variables}})'),
      headers: z.string().optional().describe('JSON string of headers array: [{"key":"...","value":"...","enabled":true}]'),
      body: z.string().optional().describe('Request body'),
      body_type: z.enum(['none', 'json', 'raw', 'form-data']).default('none').describe('Body type'),
      params: z.string().optional().describe('JSON string of params array: [{"key":"...","value":"...","enabled":true}]'),
      path_variables: z.string().optional().describe('JSON string of path variables array: [{"key":"id","value":"123"}]. Order must match the order of :name occurrences in the URL.'),
      auth_type: z.enum(['none', 'bearer']).default('none').describe('Auth type'),
      auth_token: z.string().optional().describe('Bearer token value (can use {{variables}})'),
      pre_script: z.string().optional().describe('Pre-request JavaScript'),
      post_script: z.string().optional().describe('Post-response JavaScript'),
    },
    async (args) => {
      const supabase = getClient();
      const insert: Record<string, any> = {
        collection_id: args.collection_id,
        name: args.name,
        method: args.method,
        url: args.url,
        body_type: args.body_type,
        auth_type: args.auth_type,
      };
      if (args.headers) insert.headers = args.headers;
      if (args.body) insert.body = args.body;
      if (args.params) insert.params = args.params;
      if (args.path_variables) insert.path_variables = args.path_variables;
      if (args.auth_token) insert.auth_token = args.auth_token;
      if (args.pre_script) insert.pre_script = args.pre_script;
      if (args.post_script) insert.post_script = args.post_script;

      const { data, error } = await supabase.from('requests').insert(insert).select().single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_request',
    'Update an existing HTTP request',
    {
      request_id: z.string().uuid().describe('Request ID'),
      name: z.string().optional().describe('Request name'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional().describe('HTTP method'),
      url: z.string().optional().describe('Request URL'),
      headers: z.string().optional().describe('JSON string of headers array'),
      body: z.string().optional().describe('Request body'),
      body_type: z.enum(['none', 'json', 'raw', 'form-data']).optional().describe('Body type'),
      params: z.string().optional().describe('JSON string of params array'),
      path_variables: z.string().optional().describe('JSON string of path variables array: [{"key":"id","value":"123"}]. Order must match :name occurrences in the URL.'),
      auth_type: z.enum(['none', 'bearer']).optional().describe('Auth type'),
      auth_token: z.string().optional().describe('Bearer token'),
      pre_script: z.string().optional().describe('Pre-request JavaScript'),
      post_script: z.string().optional().describe('Post-response JavaScript'),
    },
    async ({ request_id, ...updates }) => {
      const supabase = getClient();
      const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(filtered).length === 0) {
        return { content: [{ type: 'text' as const, text: 'No fields to update.' }] };
      }
      const { data, error } = await supabase.from('requests').update(filtered).eq('id', request_id).select().single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_request',
    'Delete a request and all its saved examples',
    { request_id: z.string().uuid().describe('Request ID') },
    async ({ request_id }) => {
      const supabase = getClient();
      const { error } = await supabase.from('requests').delete().eq('id', request_id);
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: `Request ${request_id} deleted.` }] };
    }
  );

}
