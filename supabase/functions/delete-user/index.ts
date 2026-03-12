import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ message: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: currentUser }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !currentUser) {
      return new Response(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: currentProfile } = await adminClient
      .from("user_profiles")
      .select("role, status")
      .eq("user_id", currentUser.id)
      .single();

    if (!currentProfile || currentProfile.status !== "active" || !["system", "admin"].includes(currentProfile.role)) {
      return new Response(
        JSON.stringify({ message: "Only system or admin users can delete users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ message: "Missing required field: userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (userId === currentUser.id) {
      return new Response(
        JSON.stringify({ message: "You cannot delete your own account" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: targetProfile } = await adminClient
      .from("user_profiles")
      .select("user_id, email, role")
      .eq("user_id", userId)
      .single();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ message: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin cannot delete system users
    if (currentProfile.role === "admin" && targetProfile.role === "system") {
      return new Response(
        JSON.stringify({ message: "Admin cannot delete system users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin can only delete users in their workspaces
    if (currentProfile.role === "admin") {
      const { data: currentUserWorkspaces } = await adminClient
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", currentUser.id);

      const { data: targetUserWorkspaces } = await adminClient
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId);

      const currentWsIds = new Set(currentUserWorkspaces?.map((w: { workspace_id: string }) => w.workspace_id) || []);
      const hasSharedWorkspace = targetUserWorkspaces?.some((w: { workspace_id: string }) => currentWsIds.has(w.workspace_id));

      if (!hasSharedWorkspace) {
        return new Response(
          JSON.stringify({ message: "You can only delete users in your workspaces" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      return new Response(
        JSON.stringify({ message: `Failed to delete user: ${deleteError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        email: targetProfile.email,
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
