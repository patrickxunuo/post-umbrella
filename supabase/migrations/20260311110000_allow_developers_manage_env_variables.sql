-- Fix: Allow developers to manage environment variables (not just admins)

-- Drop existing admin-only policies
DROP POLICY IF EXISTS "Admins can insert environment variables" ON environment_variables;
DROP POLICY IF EXISTS "Admins can update environment variables" ON environment_variables;
DROP POLICY IF EXISTS "Admins can delete environment variables" ON environment_variables;

-- Create new policies that allow both admins and developers

-- INSERT: Admins and developers can create environment variables
CREATE POLICY "Developers can insert environment variables"
ON environment_variables FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('admin', 'developer')
  )
);

-- UPDATE: Admins and developers can update environment variables
CREATE POLICY "Developers can update environment variables"
ON environment_variables FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('admin', 'developer')
  )
);

-- DELETE: Admins and developers can delete environment variables
CREATE POLICY "Developers can delete environment variables"
ON environment_variables FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('admin', 'developer')
  )
);
