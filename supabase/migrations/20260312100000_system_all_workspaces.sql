-- System users should have access to ALL workspaces without needing workspace_members entries
-- This migration updates helper functions and policies to treat system users as global

-- ============================================================================
-- 1. Update is_workspace_member to return TRUE for system users
-- ============================================================================

CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT
    -- System users are members of all workspaces
    is_system(uid)
    OR
    -- Regular check for other users
    EXISTS (
      SELECT 1 FROM workspace_members wm
      JOIN user_profiles up ON up.user_id = wm.user_id
      WHERE wm.workspace_id = ws_id AND wm.user_id = uid AND up.status = 'active'
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- 2. Update get_user_workspace_ids to return ALL workspaces for system users
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_workspace_ids(uid UUID)
RETURNS SETOF UUID AS $$
BEGIN
  -- System users get all workspaces
  IF is_system(uid) THEN
    RETURN QUERY SELECT id FROM workspaces;
  ELSE
    -- Regular users get only their memberships
    RETURN QUERY
      SELECT wm.workspace_id FROM workspace_members wm
      JOIN user_profiles up ON up.user_id = wm.user_id
      WHERE wm.user_id = uid AND up.status = 'active';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 3. Add workspace SELECT policy for system users
-- ============================================================================

-- System users can view all workspaces
CREATE POLICY "System can view all workspaces"
  ON workspaces FOR SELECT
  TO authenticated
  USING (is_system(auth.uid()));
