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

    // Create admin client with service role key
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check current user's role and status
    const { data: currentProfile } = await adminClient
      .from("user_profiles")
      .select("role, status")
      .eq("user_id", currentUser.id)
      .single();

    if (!currentProfile || currentProfile.status !== "active") {
      return new Response(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body first to check workspace access
    const { email, role, workspaceIds } = await req.json();

    if (!email || !role) {
      return new Response(
        JSON.stringify({ message: "Missing required fields: email, role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only system, admin, and developer can invite users
    if (!["system", "admin", "developer"].includes(currentProfile.role)) {
      return new Response(
        JSON.stringify({ message: "Only system, admin, or developer can invite users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Non-system users can only invite to workspaces they belong to
    let validWorkspaceIds = Array.isArray(workspaceIds) ? workspaceIds : [];
    if (currentProfile.role !== "system" && validWorkspaceIds.length > 0) {
      const { data: userWorkspaces } = await adminClient
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", currentUser.id);

      const userWsIds = new Set(userWorkspaces?.map((w: { workspace_id: string }) => w.workspace_id) || []);
      validWorkspaceIds = validWorkspaceIds.filter((id: string) => userWsIds.has(id));

      if (validWorkspaceIds.length === 0 && workspaceIds.length > 0) {
        return new Response(
          JSON.stringify({ message: "You can only invite users to workspaces you belong to" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // System role cannot be assigned via invite - only via direct DB update
    if (role === "system") {
      return new Response(
        JSON.stringify({ message: "System role can only be assigned via database" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Developers can only invite reader or developer (not admin)
    if (currentProfile.role === "developer" && !["reader", "developer"].includes(role)) {
      return new Response(
        JSON.stringify({ message: "Developers can only invite readers or developers" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["reader", "developer", "admin"].includes(role)) {
      return new Response(
        JSON.stringify({ message: "Invalid role. Must be: reader, developer, or admin" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user with this email already exists in user_profiles
    const { data: existingProfile } = await adminClient
      .from("user_profiles")
      .select("user_id, status")
      .eq("email", email.toLowerCase())
      .single();

    if (existingProfile) {
      return new Response(
        JSON.stringify({ message: "User with this email already exists" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the redirect URL for the invitation email
    const siteUrl = Deno.env.get("SITE_URL") || "https://post-umbrella.vercel.app";

    // Check if we should skip sending the invite email (for testing)
    const skipEmail = Deno.env.get("SKIP_INVITE_EMAIL") === "true";

    let newUserId: string;
    let inviteLink: string | undefined;

    if (skipEmail) {
      // Test mode: Create user without sending email, generate link manually
      const { data: newUserData, error: createError } = await adminClient.auth.admin.createUser({
        email,
        email_confirm: true,
      });

      if (createError) {
        return new Response(
          JSON.stringify({ message: `Failed to create user: ${createError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      newUserId = newUserData.user.id;

      // Generate invite link (not sent via email)
      const { data: linkData } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: siteUrl },
      });
      inviteLink = linkData?.properties?.action_link;
    } else {
      // Production mode: Invite user and send email
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo: siteUrl,
          data: {
            invited_by: currentUser.id,
            role: role,
          },
        }
      );

      if (inviteError) {
        return new Response(
          JSON.stringify({ message: `Failed to invite user: ${inviteError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      newUserId = inviteData.user.id;
    }
    const now = Math.floor(Date.now() / 1000);

    // Create user_profile with active status
    const { error: profileError } = await adminClient
      .from("user_profiles")
      .insert({
        user_id: newUserId,
        email: email.toLowerCase(),
        role,
        status: "active",
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

    // Add user to specified workspaces (validWorkspaceIds already filtered above)
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
      } else {
        // Set the first workspace as the user's active workspace
        const { error: activeError } = await adminClient
          .from("user_active_workspace")
          .insert({
            user_id: newUserId,
            workspace_id: validWorkspaceIds[0],
          });

        if (activeError) {
          console.error("Failed to set active workspace:", activeError.message);
        }
      }
    }

    const responseData: Record<string, unknown> = {
      success: true,
      user_id: newUserId,
      email,
      role,
      status: "active",
      workspaces: validWorkspaceIds,
    };

    // Include invite link in response when in test mode (no email sent)
    if (skipEmail && inviteLink) {
      responseData.invite_link = inviteLink;
      responseData.email_sent = false;
    } else {
      responseData.email_sent = true;
    }

    return new Response(
      JSON.stringify(responseData),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ message: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
