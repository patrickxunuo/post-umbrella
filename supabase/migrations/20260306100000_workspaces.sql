-- Workspace feature migration with global user roles
-- User roles are global (not per-workspace), managed in user_profiles

-- ============================================
-- NEW TABLES
-- ============================================

-- User profiles (extends auth.users with role and status)
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'developer', 'admin')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  activated_at BIGINT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Workspace members (just membership, no role - role is global in user_profiles)
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  PRIMARY KEY (workspace_id, user_id)
);

-- User's last active workspace (for remembering selection)
CREATE TABLE IF NOT EXISTS user_active_workspace (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL
);

-- ============================================
-- MODIFY COLLECTIONS TABLE
-- ============================================

-- Add workspace_id to collections (each collection belongs to exactly one workspace)
ALTER TABLE collections ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON user_profiles(status);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_collections_workspace_id ON collections(workspace_id);

-- ============================================
-- ENABLE RLS
-- ============================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_active_workspace ENABLE ROW LEVEL SECURITY;

-- ============================================
-- DROP OLD PERMISSIVE POLICIES
-- ============================================

-- Collections
DROP POLICY IF EXISTS "Authenticated users can read collections" ON collections;
DROP POLICY IF EXISTS "Authenticated users can insert collections" ON collections;
DROP POLICY IF EXISTS "Authenticated users can update collections" ON collections;
DROP POLICY IF EXISTS "Authenticated users can delete collections" ON collections;

-- Requests
DROP POLICY IF EXISTS "Authenticated users can read requests" ON requests;
DROP POLICY IF EXISTS "Authenticated users can insert requests" ON requests;
DROP POLICY IF EXISTS "Authenticated users can update requests" ON requests;
DROP POLICY IF EXISTS "Authenticated users can delete requests" ON requests;

-- Examples
DROP POLICY IF EXISTS "Authenticated users can read examples" ON examples;
DROP POLICY IF EXISTS "Authenticated users can insert examples" ON examples;
DROP POLICY IF EXISTS "Authenticated users can update examples" ON examples;
DROP POLICY IF EXISTS "Authenticated users can delete examples" ON examples;

-- Environments
DROP POLICY IF EXISTS "Authenticated users can read environments" ON environments;
DROP POLICY IF EXISTS "Authenticated users can insert environments" ON environments;
DROP POLICY IF EXISTS "Authenticated users can update environments" ON environments;
DROP POLICY IF EXISTS "Authenticated users can delete environments" ON environments;

-- ============================================
-- HELPER FUNCTIONS (security definer to bypass RLS)
-- ============================================

-- Get user's global role from user_profiles
CREATE OR REPLACE FUNCTION get_user_role(uid UUID)
RETURNS TEXT AS $$
  SELECT role FROM user_profiles WHERE user_id = uid AND status = 'active';
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get user's status from user_profiles
CREATE OR REPLACE FUNCTION get_user_status(uid UUID)
RETURNS TEXT AS $$
  SELECT status FROM user_profiles WHERE user_id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user is active
CREATE OR REPLACE FUNCTION is_user_active(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE user_id = uid AND status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user is admin (global role)
CREATE OR REPLACE FUNCTION is_admin(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = uid AND status = 'active' AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user can edit (developer or admin, and active)
CREATE OR REPLACE FUNCTION can_edit(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = uid AND status = 'active' AND role IN ('developer', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user is a member of a workspace (bypasses RLS to avoid recursion)
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members wm
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE wm.workspace_id = ws_id AND wm.user_id = uid AND up.status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get all workspace IDs a user is a member of (and is active)
CREATE OR REPLACE FUNCTION get_user_workspace_ids(uid UUID)
RETURNS SETOF UUID AS $$
  SELECT wm.workspace_id FROM workspace_members wm
  JOIN user_profiles up ON up.user_id = wm.user_id
  WHERE wm.user_id = uid AND up.status = 'active';
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user can view a collection (member of its workspace and active)
CREATE OR REPLACE FUNCTION can_view_collection(coll_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM collections c
    WHERE c.id = coll_id
    AND (
      c.workspace_id IN (SELECT get_user_workspace_ids(uid))
      OR c.workspace_id IS NULL
    )
  ) AND is_user_active(uid);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user can edit a collection (member + developer/admin role + active)
CREATE OR REPLACE FUNCTION can_edit_collection(coll_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM collections c
    WHERE c.id = coll_id
    AND (
      c.workspace_id IN (SELECT get_user_workspace_ids(uid))
      OR c.workspace_id IS NULL
    )
  ) AND can_edit(uid);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user can view a request (via collection access)
CREATE OR REPLACE FUNCTION can_view_request(req_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM requests r
    JOIN collections c ON c.id = r.collection_id
    WHERE r.id = req_id
    AND (c.workspace_id IN (SELECT get_user_workspace_ids(uid)) OR c.workspace_id IS NULL)
  ) AND is_user_active(uid);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user can edit a request (via collection access + edit permission)
CREATE OR REPLACE FUNCTION can_edit_request(req_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM requests r
    JOIN collections c ON c.id = r.collection_id
    WHERE r.id = req_id
    AND (c.workspace_id IN (SELECT get_user_workspace_ids(uid)) OR c.workspace_id IS NULL)
  ) AND can_edit(uid);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- NEW RLS POLICIES - USER PROFILES
-- ============================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- Admins can insert profiles (when inviting users)
CREATE POLICY "Admins can insert profiles"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()));

-- Admins can update profiles
CREATE POLICY "Admins can update profiles"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Users can update their own profile (limited - for activation)
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- NEW RLS POLICIES - WORKSPACES
-- ============================================

-- Workspaces: Active users can see workspaces they're members of
CREATE POLICY "Users can view their workspaces"
  ON workspaces FOR SELECT
  TO authenticated
  USING (is_workspace_member(id, auth.uid()));

-- Workspaces: Admins can create workspaces
CREATE POLICY "Admins can create workspaces"
  ON workspaces FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()));

-- Workspaces: Admins can update workspaces
CREATE POLICY "Admins can update workspaces"
  ON workspaces FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Workspaces: Admins can delete workspaces
CREATE POLICY "Admins can delete workspaces"
  ON workspaces FOR DELETE
  TO authenticated
  USING (is_admin(auth.uid()));

-- ============================================
-- NEW RLS POLICIES - WORKSPACE MEMBERS
-- ============================================

-- Workspace members: Active users can see members of their workspaces
CREATE POLICY "Users can view workspace members"
  ON workspace_members FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

-- Workspace members: Admins can add/remove members
CREATE POLICY "Admins can manage workspace members"
  ON workspace_members FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ============================================
-- NEW RLS POLICIES - USER ACTIVE WORKSPACE
-- ============================================

-- Users can manage their own active workspace
CREATE POLICY "Users can manage their active workspace"
  ON user_active_workspace FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- NEW RLS POLICIES - COLLECTIONS (workspace-scoped)
-- ============================================

-- Collections: Active users can view if in their workspace
CREATE POLICY "Users can view collections in their workspaces"
  ON collections FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    OR workspace_id IS NULL
  );

-- Collections: Developers/admins can create
CREATE POLICY "Developers can create collections"
  ON collections FOR INSERT
  TO authenticated
  WITH CHECK (
    can_edit(auth.uid()) AND (
      workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
      OR workspace_id IS NULL
    )
  );

-- Collections: Developers/admins can update
CREATE POLICY "Developers can update collections"
  ON collections FOR UPDATE
  TO authenticated
  USING (can_edit_collection(id, auth.uid()))
  WITH CHECK (true);

-- Collections: Developers/admins can delete
CREATE POLICY "Developers can delete collections"
  ON collections FOR DELETE
  TO authenticated
  USING (can_edit_collection(id, auth.uid()));

-- ============================================
-- NEW RLS POLICIES - REQUESTS
-- ============================================

-- Requests: Users can view if parent collection is accessible
CREATE POLICY "Users can view requests in their workspaces"
  ON requests FOR SELECT
  TO authenticated
  USING (can_view_collection(collection_id, auth.uid()));

-- Requests: Developers/admins can create
CREATE POLICY "Developers can create requests"
  ON requests FOR INSERT
  TO authenticated
  WITH CHECK (can_edit_collection(collection_id, auth.uid()));

-- Requests: Developers/admins can update
CREATE POLICY "Developers can update requests"
  ON requests FOR UPDATE
  TO authenticated
  USING (can_edit_collection(collection_id, auth.uid()))
  WITH CHECK (true);

-- Requests: Developers/admins can delete
CREATE POLICY "Developers can delete requests"
  ON requests FOR DELETE
  TO authenticated
  USING (can_edit_collection(collection_id, auth.uid()));

-- ============================================
-- NEW RLS POLICIES - EXAMPLES
-- ============================================

-- Examples: Users can view if parent request is accessible
CREATE POLICY "Users can view examples in their workspaces"
  ON examples FOR SELECT
  TO authenticated
  USING (can_view_request(request_id, auth.uid()));

-- Examples: Developers/admins can create
CREATE POLICY "Developers can create examples"
  ON examples FOR INSERT
  TO authenticated
  WITH CHECK (can_edit_request(request_id, auth.uid()));

-- Examples: Developers/admins can update
CREATE POLICY "Developers can update examples"
  ON examples FOR UPDATE
  TO authenticated
  USING (can_edit_request(request_id, auth.uid()))
  WITH CHECK (true);

-- Examples: Developers/admins can delete
CREATE POLICY "Developers can delete examples"
  ON examples FOR DELETE
  TO authenticated
  USING (can_edit_request(request_id, auth.uid()));

-- ============================================
-- NEW RLS POLICIES - ENVIRONMENTS
-- ============================================

-- Environments: Users can view if collection is accessible
CREATE POLICY "Users can view environments in their workspaces"
  ON environments FOR SELECT
  TO authenticated
  USING (can_view_collection(collection_id, auth.uid()));

-- Environments: Developers/admins can create
CREATE POLICY "Developers can create environments"
  ON environments FOR INSERT
  TO authenticated
  WITH CHECK (can_edit_collection(collection_id, auth.uid()));

-- Environments: Developers/admins can update
CREATE POLICY "Developers can update environments"
  ON environments FOR UPDATE
  TO authenticated
  USING (can_edit_collection(collection_id, auth.uid()))
  WITH CHECK (true);

-- Environments: Developers/admins can delete
CREATE POLICY "Developers can delete environments"
  ON environments FOR DELETE
  TO authenticated
  USING (can_edit_collection(collection_id, auth.uid()));

-- ============================================
-- DEBUG: Simple function to test auth.uid()
-- ============================================

CREATE OR REPLACE FUNCTION get_my_uid()
RETURNS UUID AS $$
BEGIN
  RETURN auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- CREATE WORKSPACE FUNCTION (bypasses RLS)
-- ============================================

CREATE OR REPLACE FUNCTION create_workspace_rpc(ws_name TEXT, ws_description TEXT DEFAULT '')
RETURNS JSON AS $$
DECLARE
  current_uid UUID;
  is_user_admin BOOLEAN;
  new_ws_id UUID;
  now_ts BIGINT;
  new_workspace RECORD;
BEGIN
  current_uid := auth.uid();
  now_ts := EXTRACT(EPOCH FROM NOW())::BIGINT;

  -- Check admin status directly (bypass RLS)
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = current_uid AND status = 'active' AND role = 'admin'
  ) INTO is_user_admin;

  IF NOT is_user_admin THEN
    RETURN json_build_object('success', false, 'message', 'Only admins can create workspaces');
  END IF;

  new_ws_id := gen_random_uuid();

  -- Insert workspace
  INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at)
  VALUES (new_ws_id, ws_name, ws_description, current_uid, now_ts, now_ts)
  RETURNING * INTO new_workspace;

  -- Add creator as member
  INSERT INTO workspace_members (workspace_id, user_id, added_by, created_at)
  VALUES (new_ws_id, current_uid, current_uid, now_ts);

  -- Set as active workspace for creator
  INSERT INTO user_active_workspace (user_id, workspace_id)
  VALUES (current_uid, new_ws_id)
  ON CONFLICT (user_id) DO UPDATE SET workspace_id = new_ws_id;

  RETURN json_build_object(
    'success', true,
    'workspace', json_build_object(
      'id', new_workspace.id,
      'name', new_workspace.name,
      'description', new_workspace.description,
      'created_by', new_workspace.created_by,
      'created_at', new_workspace.created_at,
      'updated_at', new_workspace.updated_at
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- BOOTSTRAP/ACTIVATE USER FUNCTION
-- ============================================

-- This function handles user activation on login:
-- 1. If user_profiles is empty, first user becomes admin
-- 2. If user has pending profile, activate them
-- 3. If user has no profile and others exist, return unauthorized
CREATE OR REPLACE FUNCTION bootstrap_or_activate_user()
RETURNS JSON AS $$
DECLARE
  current_uid UUID;
  profile_count INT;
  existing_profile RECORD;
  new_profile RECORD;
  now_ts BIGINT;
  default_ws_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  current_uid := auth.uid();
  now_ts := EXTRACT(EPOCH FROM NOW())::BIGINT;

  IF current_uid IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- Check if user already has a profile
  SELECT * INTO existing_profile FROM user_profiles WHERE user_id = current_uid;

  IF FOUND THEN
    -- User has a profile
    IF existing_profile.status = 'pending' THEN
      -- Activate pending user
      UPDATE user_profiles
      SET status = 'active', activated_at = now_ts, updated_at = now_ts
      WHERE user_id = current_uid;

      RETURN json_build_object(
        'success', true,
        'action', 'activated',
        'profile', json_build_object(
          'user_id', current_uid,
          'role', existing_profile.role,
          'status', 'active'
        )
      );
    ELSIF existing_profile.status = 'disabled' THEN
      RETURN json_build_object('success', false, 'action', 'disabled', 'message', 'Account is disabled');
    ELSE
      -- Already active
      RETURN json_build_object(
        'success', true,
        'action', 'none',
        'profile', json_build_object(
          'user_id', current_uid,
          'role', existing_profile.role,
          'status', existing_profile.status
        )
      );
    END IF;
  END IF;

  -- User has no profile - check if this is the first user
  SELECT COUNT(*) INTO profile_count FROM user_profiles;

  IF profile_count = 0 THEN
    -- First user becomes admin
    INSERT INTO user_profiles (user_id, role, status, invited_at, activated_at, created_at, updated_at)
    VALUES (current_uid, 'admin', 'active', now_ts, now_ts, now_ts, now_ts)
    RETURNING * INTO new_profile;

    -- Create default workspace if it doesn't exist
    INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at)
    VALUES (default_ws_id, 'Default Workspace', 'Default workspace for all users', current_uid, now_ts, now_ts)
    ON CONFLICT (id) DO NOTHING;

    -- Add user to default workspace
    INSERT INTO workspace_members (workspace_id, user_id, added_by, created_at)
    VALUES (default_ws_id, current_uid, current_uid, now_ts)
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

    -- Set as active workspace
    INSERT INTO user_active_workspace (user_id, workspace_id)
    VALUES (current_uid, default_ws_id)
    ON CONFLICT (user_id) DO UPDATE SET workspace_id = default_ws_id;

    RETURN json_build_object(
      'success', true,
      'action', 'created_admin',
      'profile', json_build_object(
        'user_id', current_uid,
        'role', 'admin',
        'status', 'active'
      )
    );
  END IF;

  -- Users exist but this user has no profile - unauthorized
  RETURN json_build_object(
    'success', false,
    'action', 'unauthorized',
    'message', 'User not authorized. Please contact an administrator to be invited.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ENABLE REALTIME FOR NEW TABLES
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE user_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE workspaces;
ALTER PUBLICATION supabase_realtime ADD TABLE workspace_members;
