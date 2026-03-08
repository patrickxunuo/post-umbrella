import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// This edge function handles user activation on login
// - If user has a pending profile, activate it
// - If user has no profile AND no profiles exist in the system, create them as admin (first user)
// - Otherwise return current profile or error

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

    // Create admin client with service role key (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const now = Math.floor(Date.now() / 1000);

    // Check if user already has a profile
    const { data: existingProfile } = await adminClient
      .from("user_profiles")
      .select("*")
      .eq("user_id", currentUser.id)
      .single();

    if (existingProfile) {
      // User has a profile
      if (existingProfile.status === "pending") {
        // Activate the pending user
        const { data: activatedProfile, error: updateError } = await adminClient
          .from("user_profiles")
          .update({
            status: "active",
            activated_at: now,
            updated_at: now,
          })
          .eq("user_id", currentUser.id)
          .select()
          .single();

        if (updateError) {
          return new Response(
            JSON.stringify({ message: `Failed to activate user: ${updateError.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ profile: activatedProfile, action: "activated" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // User already has an active or disabled profile
      return new Response(
        JSON.stringify({ profile: existingProfile, action: "none" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // User has no profile - check if this is the first user in the system
    const { count, error: countError } = await adminClient
      .from("user_profiles")
      .select("*", { count: "exact", head: true });

    if (countError) {
      return new Response(
        JSON.stringify({ message: `Failed to check existing users: ${countError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (count === 0) {
      // This is the first user - make them an admin
      const { data: newProfile, error: createError } = await adminClient
        .from("user_profiles")
        .insert({
          user_id: currentUser.id,
          role: "admin",
          status: "active",
          invited_at: now,
          activated_at: now,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (createError) {
        return new Response(
          JSON.stringify({ message: `Failed to create admin profile: ${createError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Also create a Default Workspace for the first user
      const defaultWorkspaceId = "00000000-0000-0000-0000-000000000001";

      // Check if default workspace exists
      const { data: existingWorkspace } = await adminClient
        .from("workspaces")
        .select("id")
        .eq("id", defaultWorkspaceId)
        .single();

      if (!existingWorkspace) {
        // Create default workspace
        await adminClient
          .from("workspaces")
          .insert({
            id: defaultWorkspaceId,
            name: "Default Workspace",
            description: "Default workspace for all users",
            created_by: currentUser.id,
            created_at: now,
            updated_at: now,
          });
      }

      // Add user to default workspace
      await adminClient
        .from("workspace_members")
        .upsert({
          workspace_id: defaultWorkspaceId,
          user_id: currentUser.id,
          added_by: currentUser.id,
          created_at: now,
        });

      // Set as active workspace
      await adminClient
        .from("user_active_workspace")
        .upsert({
          user_id: currentUser.id,
          workspace_id: defaultWorkspaceId,
        });

      return new Response(
        JSON.stringify({ profile: newProfile, action: "created_admin" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Users exist but this user has no profile and wasn't invited
    // They shouldn't be able to access the system
    return new Response(
      JSON.stringify({
        message: "User not authorized. Please contact an administrator to be invited.",
        action: "unauthorized"
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ message: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
