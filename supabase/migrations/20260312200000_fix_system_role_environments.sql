-- Fix: Add 'system' role to environments and environment_variables RLS policies
-- These policies were created before the system role was introduced

-- ============================================================================
-- 1. Fix environments policies
-- ============================================================================

DROP POLICY IF EXISTS "Developers can create environments" ON environments;
DROP POLICY IF EXISTS "Developers can update environments" ON environments;
DROP POLICY IF EXISTS "Developers can delete environments" ON environments;

CREATE POLICY "Developers can create environments"
  ON environments FOR INSERT
  TO authenticated
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role(auth.uid()) IN ('developer', 'admin', 'system')
  );

CREATE POLICY "Developers can update environments"
  ON environments FOR UPDATE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role(auth.uid()) IN ('developer', 'admin', 'system')
  )
  WITH CHECK (true);

CREATE POLICY "Developers can delete environments"
  ON environments FOR DELETE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role(auth.uid()) IN ('developer', 'admin', 'system')
  );

-- ============================================================================
-- 2. Fix environment_variables policies
-- ============================================================================

DROP POLICY IF EXISTS "Developers can insert environment variables" ON environment_variables;
DROP POLICY IF EXISTS "Developers can update environment variables" ON environment_variables;
DROP POLICY IF EXISTS "Developers can delete environment variables" ON environment_variables;

CREATE POLICY "Developers can insert environment variables"
ON environment_variables FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('admin', 'developer', 'system')
  )
  OR is_system(auth.uid())
);

CREATE POLICY "Developers can update environment variables"
ON environment_variables FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('admin', 'developer', 'system')
  )
  OR is_system(auth.uid())
);

CREATE POLICY "Developers can delete environment variables"
ON environment_variables FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('admin', 'developer', 'system')
  )
  OR is_system(auth.uid())
);
