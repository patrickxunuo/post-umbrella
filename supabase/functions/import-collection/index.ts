import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PostmanAuthKV {
  key: string;
  value: string;
  type?: string;
}

interface PostmanAuth {
  type?: string;
  bearer?: PostmanAuthKV[];
  apikey?: PostmanAuthKV[];
  basic?: PostmanAuthKV[];
  oauth2?: PostmanAuthKV[];
  oauth1?: PostmanAuthKV[];
}

interface PostmanEvent {
  listen?: string;
  script?: { type?: string; exec?: string | string[] };
}

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanRequest {
  method?: string;
  url?: string | { raw?: string };
  header?: PostmanHeader[];
  body?: {
    mode?: string;
    raw?: string;
    formdata?: Array<{ key: string; value?: string; type?: string; src?: string; disabled?: boolean }>;
  };
  auth?: PostmanAuth;
}

interface PostmanItem {
  name?: string;
  request?: PostmanRequest;
  item?: PostmanItem[];
  auth?: PostmanAuth;
  event?: PostmanEvent[];
}

interface PostmanCollection {
  info?: { name?: string };
  item?: PostmanItem[];
  variable?: Array<{ key: string; value?: string }>;
  auth?: PostmanAuth;
  event?: PostmanEvent[];
}

interface CollectionRecord {
  id: string;
  name: string;
  parent_id: string | null;
  workspace_id: string | null;
  auth_type: string;
  auth_token: string;
  pre_script: string;
  post_script: string;
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
  pre_script: string;
  post_script: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface CollectionVariableRecord {
  id: string;
  collection_id: string;
  key: string;
  initial_value: string;
  enabled: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface AuthParseResult {
  auth_type: string;
  auth_token: string;
  injectedHeaders: PostmanHeader[];
}

// Map a Postman auth block to our storage shape.
// `parentHasAuth` lets us distinguish "no auth block, parent has one" (inherit)
// from "no auth block, no parent either" (none). API Key in=header is injected
// into the request's headers as a best-effort mapping.
function parseAuth(
  auth: PostmanAuth | undefined | null,
  parentHasAuth: boolean,
  warnings: string[],
  context: string
): AuthParseResult {
  if (!auth) {
    return parentHasAuth
      ? { auth_type: 'inherit', auth_token: '', injectedHeaders: [] }
      : { auth_type: 'none', auth_token: '', injectedHeaders: [] };
  }
  if (auth.type === 'noauth') {
    return { auth_type: 'none', auth_token: '', injectedHeaders: [] };
  }
  if (auth.type === 'bearer' && Array.isArray(auth.bearer)) {
    const tokenItem = auth.bearer.find((b) => b.key === 'token');
    return { auth_type: 'bearer', auth_token: tokenItem?.value || '', injectedHeaders: [] };
  }
  if (auth.type === 'apikey' && Array.isArray(auth.apikey)) {
    const keyEntry = auth.apikey.find((a) => a.key === 'key');
    const valueEntry = auth.apikey.find((a) => a.key === 'value');
    const inEntry = auth.apikey.find((a) => a.key === 'in');
    const location = inEntry?.value || 'header';
    if (location === 'header' && keyEntry?.value) {
      warnings.push(
        `${context}: API Key auth mapped to header "${keyEntry.value}". Review the generated header if needed.`
      );
      return {
        auth_type: 'none',
        auth_token: '',
        injectedHeaders: [{ key: keyEntry.value, value: valueEntry?.value || '' }],
      };
    }
    warnings.push(
      `${context}: API Key auth with location "${location}" is not supported — dropped. Re-add manually as a query param.`
    );
    return { auth_type: 'none', auth_token: '', injectedHeaders: [] };
  }
  if (auth.type === 'basic') {
    warnings.push(`${context}: Basic auth is not supported yet — dropped.`);
    return { auth_type: 'none', auth_token: '', injectedHeaders: [] };
  }
  if (auth.type === 'oauth2' || auth.type === 'oauth1') {
    warnings.push(
      `${context}: OAuth auth is not supported — dropped. You'll need to configure auth manually.`
    );
    return { auth_type: 'none', auth_token: '', injectedHeaders: [] };
  }
  warnings.push(`${context}: Unknown auth type "${auth.type}" — dropped.`);
  return { auth_type: 'none', auth_token: '', injectedHeaders: [] };
}

function parseEvents(event: PostmanEvent[] | undefined): { pre_script: string; post_script: string } {
  if (!Array.isArray(event)) return { pre_script: '', post_script: '' };
  let pre_script = '';
  let post_script = '';
  for (const ev of event) {
    const exec = ev?.script?.exec;
    const code = Array.isArray(exec) ? exec.join('\n') : (exec || '');
    if (ev.listen === 'prerequest') pre_script = code;
    else if (ev.listen === 'test') post_script = code;
  }
  return { pre_script, post_script };
}

// Parse Postman collection recursively and collect all collections and requests.
// `parentHasAuth` is true when any ancestor (including this level on the way down)
// declared a concrete auth block — used so missing `auth` on descendants maps
// to `inherit` rather than `none`.
function parseCollection(
  data: PostmanCollection | PostmanItem,
  parentId: string | null,
  workspaceId: string | null,
  parentHasAuth: boolean,
  collections: CollectionRecord[],
  requests: RequestRecord[],
  warnings: string[],
  now: number
): string {
  const collectionId = crypto.randomUUID();
  const name = (data as PostmanCollection).info?.name || (data as PostmanItem).name || 'Imported Collection';

  // Folder/collection-level auth + events
  const rawAuth = (data as PostmanItem).auth || (data as PostmanCollection).auth;
  const authResult = parseAuth(rawAuth, parentHasAuth, warnings, `${parentId ? 'Folder' : 'Collection'} "${name}"`);
  const { pre_script, post_script } = parseEvents((data as PostmanItem).event || (data as PostmanCollection).event);

  collections.push({
    id: collectionId,
    name,
    parent_id: parentId,
    workspace_id: parentId ? null : workspaceId, // Only root gets workspace_id
    auth_type: authResult.auth_type,
    auth_token: authResult.auth_token,
    pre_script,
    post_script,
    created_at: now,
    updated_at: now,
  });

  // A concrete auth here (bearer, etc.) establishes auth for descendants.
  // 'none' with injected headers does not count as auth for inherit purposes.
  const childParentHasAuth = parentHasAuth || authResult.auth_type === 'bearer';

  const items = (data as PostmanCollection).item || [];
  let sortOrder = 0;

  for (const item of items) {
    if (item.request) {
      const req = item.request;
      const reqName = item.name || 'Unnamed Request';

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

      const reqAuthResult = parseAuth(req.auth, childParentHasAuth, warnings, `Request "${reqName}"`);
      // Inject apikey-as-header into the header list
      for (const h of reqAuthResult.injectedHeaders) {
        headers.push({ key: h.key, value: h.value, enabled: true });
      }

      const { pre_script: reqPre, post_script: reqPost } = parseEvents(item.event);

      requests.push({
        id: crypto.randomUUID(),
        collection_id: collectionId,
        name: reqName,
        method: (req.method || 'GET').toUpperCase(),
        url,
        headers: JSON.stringify(headers),
        body,
        body_type: bodyType,
        form_data: JSON.stringify(formData),
        params: JSON.stringify([]),
        auth_type: reqAuthResult.auth_type,
        auth_token: reqAuthResult.auth_token,
        pre_script: reqPre,
        post_script: reqPost,
        sort_order: sortOrder++,
        created_at: now,
        updated_at: now,
      });
    } else if (item.item) {
      // Folder/sub-collection: carry folder-level auth + events through.
      parseCollection(
        {
          info: { name: item.name },
          item: item.item,
          auth: item.auth,
          event: item.event,
        } as PostmanCollection,
        collectionId,
        null,
        childParentHasAuth,
        collections,
        requests,
        warnings,
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
    const warnings: string[] = [];

    const rootCollectionId = parseCollection(
      postmanData,
      null,
      workspaceId,
      false,
      collections,
      requests,
      warnings,
      now
    );

    // Build collection_variables rows (root-scoped)
    const collectionVariables: CollectionVariableRecord[] = [];
    if (Array.isArray(postmanData.variable) && postmanData.variable.length > 0) {
      postmanData.variable.forEach((v: { key?: string; value?: string }, index: number) => {
        if (!v || !v.key) return;
        collectionVariables.push({
          id: crypto.randomUUID(),
          collection_id: rootCollectionId,
          key: v.key,
          initial_value: v.value || '',
          enabled: true,
          sort_order: index,
          created_at: now,
          updated_at: now,
        });
      });
      // Note: collection variables imported successfully — no warning emitted
      // (informational message was noisy and pushed real warnings below the fold).
    }

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

    // Batch insert collection variables (non-fatal if it fails — log a warning)
    if (collectionVariables.length > 0) {
      const { error: varError } = await adminClient
        .from("collection_variables")
        .insert(collectionVariables);

      if (varError) {
        // Roll back collections + requests to keep state consistent
        await adminClient
          .from("requests")
          .delete()
          .in("id", requests.map(r => r.id));
        await adminClient
          .from("collections")
          .delete()
          .in("id", collections.map(c => c.id));

        return new Response(
          JSON.stringify({ message: `Failed to import collection variables: ${varError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        rootCollectionId,
        collectionsCount: collections.length,
        requestsCount: requests.length,
        // `environment` was the pre-0.1.12 behavior — variables now import as
        // collection variables instead. Kept as null for response-shape stability.
        environment: null,
        warnings,
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
