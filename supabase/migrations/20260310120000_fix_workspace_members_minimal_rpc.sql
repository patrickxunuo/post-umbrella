-- Fix: Update RPC function with inline membership check
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
    up.email::TEXT,
    up.role::TEXT,
    up.last_seen
  FROM workspace_members wm
  JOIN user_profiles up ON up.user_id = wm.user_id
  WHERE wm.workspace_id = ws_id
  ORDER BY wm.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
