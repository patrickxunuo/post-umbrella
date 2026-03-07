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

    // Parse request body
    const { workspaceId, email, role } = await req.json();

    if (!workspaceId || !email || !role) {
      return new Response(
        JSON.stringify({ message: "Missing required fields: workspaceId, email, role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["reader", "developer", "admin"].includes(role)) {
      return new Response(
        JSON.stringify({ message: "Invalid role. Must be: reader, developer, or admin" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client with service role key
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if current user is admin of the workspace
    const { data: membership } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", currentUser.id)
      .single();

    if (!membership || membership.role !== "admin") {
      return new Response(
        JSON.stringify({ message: "Only workspace admins can add members" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    let targetUserId: string;
    const existingUser = users.find((u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase());

    if (existingUser) {
      targetUserId = existingUser.id;
    } else {
      // Create new user
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

      targetUserId = newUserData.user.id;
    }

    // Check if user is already a member
    const { data: existingMember } = await adminClient
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .single();

    if (existingMember) {
      return new Response(
        JSON.stringify({ message: "User is already a member of this workspace" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Add user to workspace
    const now = Math.floor(Date.now() / 1000);
    const { error: insertError } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: targetUserId,
        role,
        added_by: currentUser.id,
        created_at: now,
      });

    if (insertError) {
      return new Response(
        JSON.stringify({ message: `Failed to add member: ${insertError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: targetUserId,
        email,
        role,
        is_new_user: !existingUser,
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
