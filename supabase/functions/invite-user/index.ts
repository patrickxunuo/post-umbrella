import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // Create Supabase client with user's token for verification
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user is authenticated
    const { data: { user: currentUser }, error: authError } = await userClient.auth.getUser();
    if (authError || !currentUser) {
      return new Response(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client with service role key
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if current user is an admin (global role)
    const { data: currentProfile } = await adminClient
      .from("user_profiles")
      .select("role, status")
      .eq("user_id", currentUser.id)
      .single();

    if (!currentProfile || currentProfile.status !== "active" || currentProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ message: "Only admins can invite users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { email, role, workspaceIds } = await req.json();

    if (!email || !role) {
      return new Response(
        JSON.stringify({ message: "Missing required fields: email, role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["reader", "developer", "admin"].includes(role)) {
      return new Response(
        JSON.stringify({ message: "Invalid role. Must be: reader, developer, or admin" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user with this email already exists
    const { data: { users }, error: listError } = await adminClient.auth.admin.listUsers();
    if (listError) {
      return new Response(
        JSON.stringify({ message: "Failed to check existing users" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const existingUser = users.find((u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase());

    if (existingUser) {
      return new Response(
        JSON.stringify({ message: "User with this email already exists" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create new user in auth.users
    const { data: newUserData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true, // Auto-confirm so they can login via magic link
    });

    if (createError) {
      return new Response(
        JSON.stringify({ message: `Failed to create user: ${createError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newUserId = newUserData.user.id;
    const now = Math.floor(Date.now() / 1000);

    // Create user_profile with pending status
    const { error: profileError } = await adminClient
      .from("user_profiles")
      .insert({
        user_id: newUserId,
        role,
        status: "pending",
        invited_by: currentUser.id,
        invited_at: now,
        created_at: now,
        updated_at: now,
      });

    if (profileError) {
      // Clean up: delete the created auth user
      await adminClient.auth.admin.deleteUser(newUserId);
      return new Response(
        JSON.stringify({ message: `Failed to create user profile: ${profileError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Add user to specified workspaces
    const validWorkspaceIds = Array.isArray(workspaceIds) ? workspaceIds : [];
    if (validWorkspaceIds.length > 0) {
      const workspaceMembers = validWorkspaceIds.map((wsId: string) => ({
        workspace_id: wsId,
        user_id: newUserId,
        added_by: currentUser.id,
        created_at: now,
      }));

      const { error: memberError } = await adminClient
        .from("workspace_members")
        .insert(workspaceMembers);

      if (memberError) {
        // Don't fail the whole operation, just log it
        console.error("Failed to add user to workspaces:", memberError.message);
      }
    }

    // Send magic link email so user can activate their account
    const { error: magicLinkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: supabaseUrl.replace(".supabase.co", ".vercel.app") || undefined,
      },
    });

    if (magicLinkError) {
      console.error("Failed to generate magic link:", magicLinkError.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        email,
        role,
        status: "pending",
        workspaces: validWorkspaceIds,
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
