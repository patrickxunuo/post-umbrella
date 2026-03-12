-- Role System Refactor Migration
-- Introduces 'system' role, scopes 'admin' to workspace, allows 'developer' to invite

-- ============================================================================
-- 1. Update role constraint to include 'system'
-- ============================================================================

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('reader', 'developer', 'admin', 'system'));

-- ============================================================================
-- 2. New helper functions
-- ============================================================================

-- is_system(uid) - check if user has system role
CREATE OR REPLACE FUNCTION is_system(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = uid AND status = 'active' AND role = 'system'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- is_workspace_admin(ws_id, uid) - check if user is admin AND member of specific workspace
CREATE OR REPLACE FUNCTION is_workspace_admin(ws_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    JOIN workspace_members wm ON wm.user_id = up.user_id
    WHERE up.user_id = uid
    AND up.status = 'active'
    AND up.role = 'admin'
    AND wm.workspace_id = ws_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- can_invite(uid) - system, admin, or developer can invite users
CREATE OR REPLACE FUNCTION can_invite(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = uid AND status = 'active' AND role IN ('developer', 'admin', 'system')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- 3. Update can_edit() to include system role
-- ============================================================================

CREATE OR REPLACE FUNCTION can_edit(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = uid AND status = 'active' AND role IN ('developer', 'admin', 'system')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- 4. Update RLS policies - workspaces table
-- ============================================================================

-- Drop old admin-only policies
DROP POLICY IF EXISTS "Admins can create workspaces" ON workspaces;
DROP POLICY IF EXISTS "Admins can update workspaces" ON workspaces;
DROP POLICY IF EXISTS "Admins can delete workspaces" ON workspaces;

-- CREATE: system or admin can create workspaces
CREATE POLICY "System or admin can create workspaces"
  ON workspaces FOR INSERT
  TO authenticated
  WITH CHECK (is_system(auth.uid()) OR is_admin(auth.uid()));

-- UPDATE: system can update any, admin can update workspaces they're member of
CREATE POLICY "System or workspace admin can update workspaces"
  ON workspaces FOR UPDATE
  TO authenticated
  USING (is_system(auth.uid()) OR is_workspace_admin(id, auth.uid()))
  WITH CHECK (is_system(auth.uid()) OR is_workspace_admin(id, auth.uid()));

-- DELETE: system can delete any, admin can delete workspaces they're member of
CREATE POLICY "System or workspace admin can delete workspaces"
  ON workspaces FOR DELETE
  TO authenticated
  USING (is_system(auth.uid()) OR is_workspace_admin(id, auth.uid()));

-- ============================================================================
-- 5. Update RLS policies - workspace_members table
-- ============================================================================

DROP POLICY IF EXISTS "Admins can manage workspace members" ON workspace_members;

-- System can manage any, admin can manage members of workspaces they belong to
CREATE POLICY "System or workspace admin can manage members"
  ON workspace_members FOR ALL
  TO authenticated
  USING (is_system(auth.uid()) OR is_workspace_admin(workspace_id, auth.uid()))
  WITH CHECK (is_system(auth.uid()) OR is_workspace_admin(workspace_id, auth.uid()));

-- ============================================================================
-- 6. Update RLS policies - user_profiles table
-- ============================================================================

-- Drop old admin policies
DROP POLICY IF EXISTS "Admins can update profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

-- System can insert new profiles (when inviting)
CREATE POLICY "System can insert profiles"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (is_system(auth.uid()));

-- System can update any profile (role, status changes)
CREATE POLICY "System can update any profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (is_system(auth.uid()))
  WITH CHECK (is_system(auth.uid()));

-- System can view all profiles
CREATE POLICY "System can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (is_system(auth.uid()));

-- Admin can view profiles of users in their workspaces
CREATE POLICY "Admins can view workspace member profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) = 'admin' AND
    user_id IN (
      SELECT wm.user_id FROM workspace_members wm
      WHERE wm.workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    )
  );

-- Admin can update profiles of users in their workspaces (but not system users)
CREATE POLICY "Admins can update workspace member profiles"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (
    get_user_role(auth.uid()) = 'admin' AND
    role != 'system' AND
    user_id IN (
      SELECT wm.user_id FROM workspace_members wm
      WHERE wm.workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    )
  )
  WITH CHECK (
    get_user_role(auth.uid()) = 'admin' AND
    role != 'system' AND
    user_id IN (
      SELECT wm.user_id FROM workspace_members wm
      WHERE wm.workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    )
  );

-- Admin can delete profiles of users in their workspaces (but not system users)
CREATE POLICY "Admins can delete workspace member profiles"
  ON user_profiles FOR DELETE
  TO authenticated
  USING (
    get_user_role(auth.uid()) = 'admin' AND
    role != 'system' AND
    user_id IN (
      SELECT wm.user_id FROM workspace_members wm
      WHERE wm.workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    )
  );

-- ============================================================================
-- 7. Update create_workspace_rpc to allow admin
-- ============================================================================

CREATE OR REPLACE FUNCTION create_workspace_rpc(ws_name TEXT, ws_description TEXT DEFAULT '')
RETURNS JSON AS $$
DECLARE
  current_uid UUID;
  user_role TEXT;
  new_ws_id UUID;
  now_ts BIGINT;
  new_workspace RECORD;
BEGIN
  current_uid := auth.uid();
  now_ts := EXTRACT(EPOCH FROM NOW())::BIGINT;

  -- Get user role directly (bypass RLS)
  SELECT role INTO user_role
  FROM user_profiles
  WHERE user_id = current_uid AND status = 'active';

  -- Only system and admin can create workspaces
  IF user_role IS NULL OR user_role NOT IN ('system', 'admin') THEN
    RETURN json_build_object('success', false, 'message', 'Only system and admin users can create workspaces');
  END IF;

  -- Generate new workspace ID
  new_ws_id := gen_random_uuid();

  -- Insert workspace
  INSERT INTO workspaces (id, name, description, created_at, updated_at)
  VALUES (new_ws_id, ws_name, ws_description, now_ts, now_ts);

  -- Add creator as member
  INSERT INTO workspace_members (workspace_id, user_id, added_by, created_at)
  VALUES (new_ws_id, current_uid, current_uid, now_ts);

  -- Set as active workspace
  INSERT INTO user_active_workspace (user_id, workspace_id)
  VALUES (current_uid, new_ws_id)
  ON CONFLICT (user_id) DO UPDATE SET workspace_id = new_ws_id;

  -- Return the new workspace
  SELECT id, name, description, created_at, updated_at
  INTO new_workspace
  FROM workspaces WHERE id = new_ws_id;

  RETURN json_build_object(
    'success', true,
    'workspace', json_build_object(
      'id', new_workspace.id,
      'name', new_workspace.name,
      'description', new_workspace.description,
      'created_at', new_workspace.created_at,
      'updated_at', new_workspace.updated_at
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
