-- Fix: Update RLS policies for environments to use workspace_id instead of collection_id
-- Environments are now workspace-scoped, not collection-scoped

-- Drop old collection-based policies
DROP POLICY IF EXISTS "Users can view environments in their workspaces" ON environments;
DROP POLICY IF EXISTS "Developers can create environments" ON environments;
DROP POLICY IF EXISTS "Developers can update environments" ON environments;
DROP POLICY IF EXISTS "Developers can delete environments" ON environments;

-- Create new workspace-based policies

-- SELECT: Users can view environments in workspaces they're members of
CREATE POLICY "Users can view environments in their workspaces"
  ON environments FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

-- INSERT: Developers/admins can create environments in their workspaces
CREATE POLICY "Developers can create environments"
  ON environments FOR INSERT
  TO authenticated
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role(auth.uid()) IN ('developer', 'admin')
  );

-- UPDATE: Developers/admins can update environments in their workspaces
CREATE POLICY "Developers can update environments"
  ON environments FOR UPDATE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role(auth.uid()) IN ('developer', 'admin')
  )
  WITH CHECK (true);

-- DELETE: Developers/admins can delete environments in their workspaces
CREATE POLICY "Developers can delete environments"
  ON environments FOR DELETE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role(auth.uid()) IN ('developer', 'admin')
  );
