import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

async function getCollectionTree(supabase: SupabaseClient, rootId: string) {
  const { data: root, error: rootError } = await supabase
    .from('collections')
    .select('id, name, parent_id, workspace_id, created_at, updated_at')
    .eq('id', rootId)
    .single();
  if (rootError) throw new Error(rootError.message);

  const allCollections = [root];
  let currentParentIds = [root.id];

  while (currentParentIds.length > 0) {
    const { data: children, error } = await supabase
      .from('collections')
      .select('id, name, parent_id, workspace_id, created_at, updated_at')
      .in('parent_id', currentParentIds)
      .order('name');
    if (error) throw new Error(error.message);
    if (!children || children.length === 0) break;
    allCollections.push(...children);
    currentParentIds = children.map((c: any) => c.id);
  }

  const collectionIds = allCollections.map((c: any) => c.id);
  const { data: requests, error: reqError } = await supabase
    .from('requests')
    .select('id, name, method, url, collection_id, sort_order, created_at, updated_at')
    .in('collection_id', collectionIds)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (reqError) throw new Error(reqError.message);

  const requestsByCollection = new Map<string, any[]>();
  for (const req of (requests || [])) {
    const existing = requestsByCollection.get(req.collection_id) || [];
    existing.push(req);
    requestsByCollection.set(req.collection_id, existing);
  }

  const collectionMap = new Map<string, any>();
  for (const c of allCollections) {
    collectionMap.set(c.id, { ...c, folders: [], requests: requestsByCollection.get(c.id) || [] });
  }
  for (const c of allCollections) {
    if (!c.parent_id) continue;
    const parent = collectionMap.get(c.parent_id);
    const child = collectionMap.get(c.id);
    if (parent && child) parent.folders.push(child);
  }

  return collectionMap.get(root.id);
}

export function registerResolveTools(server: McpServer, getClient: () => SupabaseClient) {
  server.tool(
    'resolve_link',
    'Resolve a Post Umbrella resource link. Takes a type (collection, folder, request, example) and ID, returns the full resource data. Use this when the user pastes a Post Umbrella link.',
    {
      type: z.enum(['collection', 'folder', 'request', 'example']).describe('Resource type'),
      id: z.string().uuid().describe('Resource ID'),
    },
    async ({ type, id }) => {
      const supabase = getClient();

      try {
        switch (type) {
          case 'collection': {
            const tree = await getCollectionTree(supabase, id);
            if (!tree || tree.parent_id !== null) {
              return { content: [{ type: 'text' as const, text: 'Error: Not a top-level collection.' }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(tree, null, 2) }] };
          }

          case 'folder': {
            const tree = await getCollectionTree(supabase, id);
            if (!tree || !tree.parent_id) {
              return { content: [{ type: 'text' as const, text: 'Error: Not a nested folder.' }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(tree, null, 2) }] };
          }

          case 'request': {
            const { data, error } = await supabase.from('requests').select('*').eq('id', id).single();
            if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };

            // Also fetch examples for this request
            const { data: examples } = await supabase
              .from('examples')
              .select('id, name, created_at')
              .eq('request_id', id)
              .order('created_at', { ascending: false });

            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ ...data, examples: examples || [] }, null, 2),
              }],
            };
          }

          case 'example': {
            const { data, error } = await supabase.from('examples').select('*').eq('id', id).single();
            if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text' as const, text: `Error: Unknown type "${type}"` }], isError: true };
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
