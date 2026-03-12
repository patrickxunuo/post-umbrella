-- Fix: Allow all workspace members to see other members (regardless of status)
-- Previously required status = 'active' which blocked some users

-- Create a simpler function that just checks membership (no status check)
CREATE OR REPLACE FUNCTION is_workspace_member_simple(ws_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = ws_id AND wm.user_id = uid
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Drop and recreate the policy to use simpler check
DROP POLICY IF EXISTS "Users can view workspace members" ON workspace_members;

CREATE POLICY "Users can view workspace members"
  ON workspace_members FOR SELECT
  TO authenticated
  USING (is_workspace_member_simple(workspace_id, auth.uid()));

-- RPC function to get minimal workspace member info (bypasses RLS)
-- Returns only: user_id, email, role, last_seen for presence avatars
CREATE OR REPLACE FUNCTION get_workspace_members_minimal(ws_id UUID)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  last_seen BIGINT
) AS $$
DECLARE
  is_member BOOLEAN;
BEGIN
  -- Check if caller is a member of this workspace (inline check)
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id AND workspace_members.user_id = auth.uid()
  ) INTO is_member;

  IF NOT is_member THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    wm.user_id,
    up.email,
    up.role,
    up.last_seen
  FROM workspace_members wm
  JOIN user_profiles up ON up.user_id = wm.user_id
  WHERE wm.workspace_id = ws_id
  ORDER BY wm.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
