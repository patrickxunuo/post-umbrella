import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PostmanRequest {
  method?: string;
  url?: string | { raw?: string };
  header?: Array<{ key: string; value: string; disabled?: boolean }>;
  body?: {
    mode?: string;
    raw?: string;
    formdata?: Array<{ key: string; value?: string; type?: string; src?: string; disabled?: boolean }>;
  };
  auth?: {
    type?: string;
    bearer?: Array<{ key: string; value: string }>;
  };
}

interface PostmanItem {
  name?: string;
  request?: PostmanRequest;
  item?: PostmanItem[];
}

interface PostmanCollection {
  info?: { name?: string };
  item?: PostmanItem[];
  variable?: Array<{ key: string; value: string }>;
}

interface CollectionRecord {
  id: string;
  name: string;
  parent_id: string | null;
  workspace_id: string | null;
  created_at: number;
  updated_at: number;
}

interface RequestRecord {
  id: string;
  collection_id: string;
  name: string;
  method: string;
  url: string;
  headers: string;
  body: string;
  body_type: string;
  form_data: string;
  params: string;
  auth_type: string;
  auth_token: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

// Parse Postman collection recursively and collect all collections and requests
function parseCollection(
  data: PostmanCollection | PostmanItem,
  parentId: string | null,
  workspaceId: string | null,
  collections: CollectionRecord[],
  requests: RequestRecord[],
  now: number
): string {
  const collectionId = crypto.randomUUID();
  const name = (data as PostmanCollection).info?.name || (data as PostmanItem).name || 'Imported Collection';

  collections.push({
    id: collectionId,
    name,
    parent_id: parentId,
    workspace_id: parentId ? null : workspaceId, // Only root gets workspace_id
    created_at: now,
    updated_at: now,
  });

  const items = (data as PostmanCollection).item || [];
  let sortOrder = 0;

  for (const item of items) {
    if (item.request) {
      // It's a request
      const req = item.request;

      let url = '';
      if (typeof req.url === 'string') {
        url = req.url;
      } else if (req.url?.raw) {
        url = req.url.raw;
      }

      const headers = (req.header || []).map(h => ({
        key: h.key,
        value: h.value,
        enabled: !h.disabled,
      }));

      let body = '';
      let bodyType = 'none';
      let formData: Array<{ key: string; value: string; type: string; enabled: boolean }> = [];

      if (req.body) {
        if (req.body.mode === 'raw') {
          body = req.body.raw || '';
          bodyType = 'json';
        } else if (req.body.mode === 'formdata') {
          bodyType = 'form-data';
          formData = (req.body.formdata || []).map(f => ({
            key: f.key,
            value: f.value || '',
            type: f.type === 'file' ? 'file' : 'text',
            enabled: !f.disabled,
          }));
        }
      }

      let authType = 'none';
      let authToken = '';
      if (req.auth?.type === 'bearer' && req.auth.bearer) {
        authType = 'bearer';
        const tokenItem = req.auth.bearer.find(b => b.key === 'token');
        authToken = tokenItem?.value || '';
      }

      requests.push({
        id: crypto.randomUUID(),
        collection_id: collectionId,
        name: item.name || 'Unnamed Request',
        method: (req.method || 'GET').toUpperCase(),
        url,
        headers: JSON.stringify(headers),
        body,
        body_type: bodyType,
        form_data: JSON.stringify(formData),
        params: JSON.stringify([]),
        auth_type: authType,
        auth_token: authToken,
        sort_order: sortOrder++,
        created_at: now,
        updated_at: now,
      });
    } else if (item.item) {
      // It's a folder/sub-collection
      parseCollection(
        { info: { name: item.name }, item: item.item } as PostmanCollection,
        collectionId,
        null,
        collections,
        requests,
        now
      );
    }
  }

  return collectionId;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ message: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Extract token and verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: currentUser }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !currentUser) {
      return new Response(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client with service role key for batch inserts
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const { postmanData, workspaceId } = await req.json();

    if (!postmanData || !postmanData.info) {
      return new Response(
        JSON.stringify({ message: "Invalid Postman collection format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const collectionName = postmanData.info?.name || 'Imported Collection';

    // Check if collection with this name already exists in workspace
    const { data: existing } = await adminClient
      .from("collections")
      .select("id")
      .eq("name", collectionName)
      .eq("workspace_id", workspaceId)
      .is("parent_id", null)
      .single();

    if (existing) {
      return new Response(
        JSON.stringify({ message: `A collection named "${collectionName}" already exists. Please rename or delete the existing collection before importing.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the entire collection tree
    const now = Math.floor(Date.now() / 1000);
    const collections: CollectionRecord[] = [];
    const requests: RequestRecord[] = [];

    const rootCollectionId = parseCollection(
      postmanData,
      null,
      workspaceId,
      collections,
      requests,
      now
    );

    // Batch insert all collections
    if (collections.length > 0) {
      const { error: collError } = await adminClient
        .from("collections")
        .insert(collections);

      if (collError) {
        return new Response(
          JSON.stringify({ message: `Failed to import collections: ${collError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Batch insert all requests
    if (requests.length > 0) {
      const { error: reqError } = await adminClient
        .from("requests")
        .insert(requests);

      if (reqError) {
        // Rollback: delete the collections we just created
        await adminClient
          .from("collections")
          .delete()
          .in("id", collections.map(c => c.id));

        return new Response(
          JSON.stringify({ message: `Failed to import requests: ${reqError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Import environment variables if present
    let environment = null;
    if (postmanData.variable && postmanData.variable.length > 0 && workspaceId) {
      const envId = crypto.randomUUID();
      const envName = `${collectionName} Variables`;

      // Create environment
      const { error: envError } = await adminClient
        .from("environments")
        .insert({
          id: envId,
          name: envName,
          workspace_id: workspaceId,
          created_by: currentUser.id,
          updated_by: currentUser.id,
          created_at: now,
          updated_at: now,
        });

      if (!envError) {
        // Create environment variables
        const envVars = postmanData.variable.map((v: { key: string; value?: string }, index: number) => ({
          id: crypto.randomUUID(),
          environment_id: envId,
          key: v.key,
          initial_value: v.value || '',
          enabled: true,
          sort_order: index,
          created_at: now,
          updated_at: now,
        }));

        if (envVars.length > 0) {
          await adminClient
            .from("environment_variables")
            .insert(envVars);
        }

        environment = { id: envId, name: envName };
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        rootCollectionId,
        collectionsCount: collections.length,
        requestsCount: requests.length,
        environment,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ message: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
