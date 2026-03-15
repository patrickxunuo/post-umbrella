import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

type CollectionRow = {
  id: string;
  name: string;
  parent_id: string | null;
  workspace_id: string | null;
  created_at?: string;
  updated_at?: string;
};

type RequestRow = {
  id: string;
  name: string;
  method: string;
  url: string;
  collection_id: string;
  sort_order?: number | null;
  created_at?: string;
  updated_at?: string;
};

async function getCollectionRow(supabase: SupabaseClient, id: string): Promise<{ data: CollectionRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('collections')
    .select('id, name, parent_id, workspace_id, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as CollectionRow, error: null };
}

async function getCollectionTree(supabase: SupabaseClient, root: CollectionRow) {
  const allCollections: CollectionRow[] = [root];
  let currentParentIds = [root.id];

  while (currentParentIds.length > 0) {
    const { data: children, error } = await supabase
      .from('collections')
      .select('id, name, parent_id, workspace_id, created_at, updated_at')
      .in('parent_id', currentParentIds)
      .order('name');

    if (error) {
      throw new Error(error.message);
    }

    const childRows = (children || []) as CollectionRow[];
    if (childRows.length === 0) {
      break;
    }

    allCollections.push(...childRows);
    currentParentIds = childRows.map((child) => child.id);
  }

  const collectionIds = allCollections.map((collection) => collection.id);
  const { data: requests, error: requestsError } = await supabase
    .from('requests')
    .select('id, name, method, url, collection_id, sort_order, created_at, updated_at')
    .in('collection_id', collectionIds)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (requestsError) {
    throw new Error(requestsError.message);
  }

  const requestsByCollectionId = new Map<string, RequestRow[]>();
  for (const request of (requests || []) as RequestRow[]) {
    const existing = requestsByCollectionId.get(request.collection_id) || [];
    existing.push(request);
    requestsByCollectionId.set(request.collection_id, existing);
  }

  const collectionMap = new Map<string, any>();
  for (const collection of allCollections) {
    collectionMap.set(collection.id, {
      ...collection,
      folders: [],
      requests: requestsByCollectionId.get(collection.id) || [],
    });
  }

  for (const collection of allCollections) {
    if (!collection.parent_id) continue;
    const parent = collectionMap.get(collection.parent_id);
    const child = collectionMap.get(collection.id);
    if (parent && child) {
      parent.folders.push(child);
    }
  }

  return collectionMap.get(root.id);
}

export function registerCollectionTools(server: McpServer, getClient: () => SupabaseClient) {
  server.tool(
    'list_collections',
    'List top-level collections directly under a workspace.',
    { workspace_id: z.string().uuid().describe('Workspace ID') },
    async ({ workspace_id }) => {
      const supabase = getClient();
      const { data, error } = await supabase
        .from('collections')
        .select('id, name, parent_id, workspace_id, created_at, updated_at')
        .eq('workspace_id', workspace_id)
        .is('parent_id', null)
        .order('name');
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data || [], null, 2) }] };
    }
  );

  server.tool(
    'get_collection',
    'Get a top-level collection by ID, including all nested folders and requests inside it.',
    { collection_id: z.string().uuid().describe('Collection ID') },
    async ({ collection_id }) => {
      const supabase = getClient();
      const { data, error } = await getCollectionRow(supabase, collection_id);
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error}` }], isError: true };
      if (!data || data.parent_id !== null || !data.workspace_id) {
        return { content: [{ type: 'text' as const, text: 'Error: Item is not a top-level collection.' }], isError: true };
      }
      try {
        const tree = await getCollectionTree(supabase, data);
        return { content: [{ type: 'text' as const, text: JSON.stringify(tree, null, 2) }] };
      } catch (treeError: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${treeError.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_folder',
    'Get a nested folder by ID, including all nested subfolders and requests inside it.',
    { folder_id: z.string().uuid().describe('Folder ID') },
    async ({ folder_id }) => {
      const supabase = getClient();
      const { data, error } = await getCollectionRow(supabase, folder_id);
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error}` }], isError: true };
      if (!data || !data.parent_id || data.workspace_id) {
        return { content: [{ type: 'text' as const, text: 'Error: Item is not a nested folder.' }], isError: true };
      }
      try {
        const tree = await getCollectionTree(supabase, data);
        return { content: [{ type: 'text' as const, text: JSON.stringify(tree, null, 2) }] };
      } catch (treeError: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${treeError.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'add_folder',
    'Add a folder under an existing collection or folder.',
    {
      name: z.string().describe('Folder name'),
      parent_id: z.string().uuid().describe('Parent collection or folder ID'),
    },
    async ({ name, parent_id }) => {
      const supabase = getClient();
      const parent = await getCollectionRow(supabase, parent_id);
      if (parent.error) return { content: [{ type: 'text' as const, text: `Error: ${parent.error}` }], isError: true };
      if (!parent.data) return { content: [{ type: 'text' as const, text: 'Error: Parent not found.' }], isError: true };

      const { data, error } = await supabase
        .from('collections')
        .insert({ name, parent_id, workspace_id: null })
        .select()
        .single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_collection',
    'Create a new top-level collection directly under a workspace.',
    {
      workspace_id: z.string().uuid().describe('Workspace ID'),
      name: z.string().describe('Collection name'),
    },
    async ({ workspace_id, name }) => {
      const supabase = getClient();
      const { data, error } = await supabase
        .from('collections')
        .insert({ name, workspace_id, parent_id: null })
        .select()
        .single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'rename_folder',
    'Rename a nested folder.',
    {
      folder_id: z.string().uuid().describe('Folder ID'),
      name: z.string().describe('New folder name'),
    },
    async ({ folder_id, name }) => {
      const supabase = getClient();
      const existing = await getCollectionRow(supabase, folder_id);
      if (existing.error) return { content: [{ type: 'text' as const, text: `Error: ${existing.error}` }], isError: true };
      if (!existing.data || !existing.data.parent_id || existing.data.workspace_id) {
        return { content: [{ type: 'text' as const, text: 'Error: Item is not a folder.' }], isError: true };
      }
      const { data, error } = await supabase.from('collections').update({ name }).eq('id', folder_id).select().single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'rename_collection',
    'Rename a top-level collection.',
    {
      collection_id: z.string().uuid().describe('Collection ID'),
      name: z.string().describe('New collection name'),
    },
    async ({ collection_id, name }) => {
      const supabase = getClient();
      const existing = await getCollectionRow(supabase, collection_id);
      if (existing.error) return { content: [{ type: 'text' as const, text: `Error: ${existing.error}` }], isError: true };
      if (!existing.data || existing.data.parent_id !== null || !existing.data.workspace_id) {
        return { content: [{ type: 'text' as const, text: 'Error: Item is not a top-level collection.' }], isError: true };
      }
      const { data, error } = await supabase.from('collections').update({ name }).eq('id', collection_id).select().single();
      if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

}
