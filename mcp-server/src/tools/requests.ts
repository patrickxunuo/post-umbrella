import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

type CollectionNode = {
  id: string;
  parent_id: string | null;
  workspace_id: string | null;
};

type EnvironmentVariable = {
  id: string;
  key: string;
  initial_value: string | null;
  enabled: boolean | null;
  sort_order: number | null;
};

async function getCollectionNode(supabase: SupabaseClient, collectionId: string): Promise<CollectionNode | null> {
  const { data, error } = await supabase
    .from('collections')
    .select('id, parent_id, workspace_id')
    .eq('id', collectionId)
    .single();

  if (error || !data) return null;
  return data as CollectionNode;
}

async function resolveWorkspaceIdForCollection(supabase: SupabaseClient, collectionId: string): Promise<string | null> {
  let currentId: string | null = collectionId;

  while (currentId) {
    const node = await getCollectionNode(supabase, currentId);
    if (!node) return null;
    if (node.workspace_id) return node.workspace_id;
    currentId = node.parent_id;
  }

  return null;
}

async function getEnvironmentVariables(
  supabase: SupabaseClient,
  environmentId: string
): Promise<Array<{ key: string; value: string; enabled: boolean }>> {
  const { data: variables, error: variablesError } = await supabase
    .from('environment_variables')
    .select('id, key, initial_value, enabled, sort_order')
    .eq('environment_id', environmentId)
    .order('sort_order');

  if (variablesError) {
    throw new Error(variablesError.message);
  }

  const variableIds = (variables || []).map((variable: any) => variable.id);
  let currentValuesById: Record<string, string> = {};

  if (variableIds.length > 0) {
    const { data: currentValues, error: currentValuesError } = await supabase
      .from('environment_user_values')
      .select('variable_id, current_value')
      .in('variable_id', variableIds);

    if (currentValuesError) {
      throw new Error(currentValuesError.message);
    }

    for (const currentValue of currentValues || []) {
      currentValuesById[currentValue.variable_id] = currentValue.current_value;
    }
  }

  return (variables || []).map((variable: EnvironmentVariable) => ({
    key: variable.key,
    value: currentValuesById[variable.id] || variable.initial_value || '',
    enabled: variable.enabled !== false,
  }));
}

function substituteEnvironmentVariables(text: string | null | undefined, variables: Array<{ key: string; value: string; enabled: boolean }>) {
  if (!text) return text;

  let result = text;
  for (const variable of variables) {
    if (!variable.enabled || !variable.key) continue;
    const regex = new RegExp(`\\{\\{${variable.key}\\}\\}`, 'g');
    result = result.replace(regex, variable.value || '');
  }
  return result;
}

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

  server.tool(
    'send_request',
    'Execute an HTTP request by ID and return the response. Optionally resolve variables from a chosen environment by ID or name before sending via the Supabase proxy edge function.',
    {
      request_id: z.string().uuid().describe('Request ID to execute'),
      environment_id: z.string().uuid().optional().describe('Environment ID to use for variable substitution'),
      environment_name: z.string().optional().describe('Environment name to use for variable substitution within the request workspace'),
    },
    async ({ request_id, environment_id, environment_name }) => {
      const supabase = getClient();

      if (environment_id && environment_name) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Provide either environment_id or environment_name, not both.' }],
          isError: true,
        };
      }

      // Fetch request details
      const { data: req, error } = await supabase.from('requests').select('*').eq('id', request_id).single();
      if (error || !req) return { content: [{ type: 'text' as const, text: `Error: ${error?.message || 'Request not found'}` }], isError: true };

      let environmentVariables: Array<{ key: string; value: string; enabled: boolean }> = [];
      let selectedEnvironment: { id: string; name: string } | null = null;

      if (environment_id || environment_name) {
        const workspaceId = await resolveWorkspaceIdForCollection(supabase, req.collection_id);
        if (!workspaceId) {
          return { content: [{ type: 'text' as const, text: 'Error: Could not resolve workspace for request collection.' }], isError: true };
        }

        if (environment_id) {
          const { data: environment, error: environmentError } = await supabase
            .from('environments')
            .select('id, name, workspace_id')
            .eq('id', environment_id)
            .eq('workspace_id', workspaceId)
            .single();

          if (environmentError || !environment) {
            return { content: [{ type: 'text' as const, text: `Error: ${environmentError?.message || 'Environment not found in request workspace'}` }], isError: true };
          }

          selectedEnvironment = { id: environment.id, name: environment.name };
        } else if (environment_name) {
          const { data: environments, error: environmentError } = await supabase
            .from('environments')
            .select('id, name')
            .eq('workspace_id', workspaceId)
            .eq('name', environment_name)
            .limit(2);

          if (environmentError) {
            return { content: [{ type: 'text' as const, text: `Error: ${environmentError.message}` }], isError: true };
          }
          if (!environments || environments.length === 0) {
            return { content: [{ type: 'text' as const, text: `Error: Environment "${environment_name}" not found in request workspace.` }], isError: true };
          }
          if (environments.length > 1) {
            return { content: [{ type: 'text' as const, text: `Error: Multiple environments named "${environment_name}" found in request workspace. Use environment_id instead.` }], isError: true };
          }

          selectedEnvironment = { id: environments[0].id, name: environments[0].name };
        }

        environmentVariables = await getEnvironmentVariables(supabase, selectedEnvironment!.id);
      }

      // Get session for proxy auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { content: [{ type: 'text' as const, text: 'Error: No active session' }], isError: true };

      // Get proxy URL from Supabase URL
      const supabaseUrl = process.env.SUPABASE_URL!;
      const proxyUrl = `${supabaseUrl}/functions/v1/proxy`;

      const resolvedUrl = substituteEnvironmentVariables(req.url, environmentVariables);
      const resolvedHeaders = (typeof req.headers === 'string' ? JSON.parse(req.headers) : req.headers || []).map((header: any) => ({
        ...header,
        key: substituteEnvironmentVariables(header.key, environmentVariables),
        value: substituteEnvironmentVariables(header.value, environmentVariables),
      }));
      const resolvedBody = substituteEnvironmentVariables(req.body, environmentVariables);
      const resolvedFormData = (typeof req.form_data === 'string' ? JSON.parse(req.form_data) : req.form_data || []).map((field: any) => ({
        ...field,
        key: substituteEnvironmentVariables(field.key, environmentVariables),
        value: field.type === 'file' ? field.value : substituteEnvironmentVariables(field.value, environmentVariables),
      }));
      const resolvedParams = (typeof req.params === 'string' ? JSON.parse(req.params) : req.params || []).map((param: any) => ({
        ...param,
        key: substituteEnvironmentVariables(param.key, environmentVariables),
        value: substituteEnvironmentVariables(param.value, environmentVariables),
      }));
      const resolvedAuthToken = substituteEnvironmentVariables(req.auth_token, environmentVariables);

      if (req.auth_type === 'bearer' && resolvedAuthToken) {
        const hasAuthorization = resolvedHeaders.some((header: any) =>
          String(header.key || '').toLowerCase() === 'authorization' && header.enabled !== false
        );
        if (!hasAuthorization) {
          resolvedHeaders.push({
            key: 'Authorization',
            value: `Bearer ${resolvedAuthToken}`,
            enabled: true,
          });
        }
      }

      if (req.body_type === 'json' && resolvedBody) {
        const hasContentType = resolvedHeaders.some((header: any) =>
          String(header.key || '').toLowerCase() === 'content-type' && header.enabled !== false
        );
        if (!hasContentType) {
          resolvedHeaders.push({
            key: 'Content-Type',
            value: 'application/json',
            enabled: true,
          });
        }
      }

      const payload: Record<string, any> = {
        method: req.method,
        url: resolvedUrl,
        headers: resolvedHeaders,
        bodyType: req.body_type,
      };
      if (resolvedBody) payload.body = resolvedBody;
      if (resolvedFormData.length > 0) payload.formData = resolvedFormData;
      if (resolvedParams.length > 0) payload.params = resolvedParams;

      try {
        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              environment: selectedEnvironment,
              result,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error sending request: ${err.message}` }], isError: true };
      }
    }
  );
}
