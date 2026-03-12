-- ============================================
-- Normalize Environment Variables Storage
-- Migrate from JSON column to separate table
-- ============================================

-- STEP 1: Create the new environment_variables table
CREATE TABLE IF NOT EXISTS environment_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  initial_value TEXT DEFAULT '',
  enabled BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE(environment_id, key)
);

-- STEP 2: Migrate existing JSON data to the new table
INSERT INTO environment_variables (environment_id, key, initial_value, enabled, sort_order)
SELECT
  e.id AS environment_id,
  (json_elem->>'key')::text AS key,
  COALESCE(json_elem->>'initial_value', json_elem->>'value', '') AS initial_value,
  COALESCE((json_elem->>'enabled')::boolean, true) AS enabled,
  (row_number() OVER (PARTITION BY e.id ORDER BY ordinality) - 1)::int AS sort_order
FROM environments e,
LATERAL json_array_elements(
  CASE
    WHEN e.variables IS NOT NULL AND e.variables != '' AND e.variables != '[]'
    THEN e.variables::json
    ELSE '[]'::json
  END
) WITH ORDINALITY AS t(json_elem, ordinality)
WHERE (json_elem->>'key') IS NOT NULL AND (json_elem->>'key') != ''
ON CONFLICT (environment_id, key) DO NOTHING;

-- STEP 3: Add variable_id column to environment_user_values
ALTER TABLE environment_user_values
  ADD COLUMN IF NOT EXISTS variable_id UUID REFERENCES environment_variables(id) ON DELETE CASCADE;

-- STEP 4: Populate variable_id from existing variable_key
UPDATE environment_user_values euv
SET variable_id = ev.id
FROM environment_variables ev
WHERE euv.environment_id = ev.environment_id
  AND euv.variable_key = ev.key
  AND euv.variable_id IS NULL;

-- STEP 5: Delete orphaned user values (where variable doesn't exist)
DELETE FROM environment_user_values
WHERE variable_id IS NULL;

-- STEP 6: Make variable_id required and drop old columns
ALTER TABLE environment_user_values
  ALTER COLUMN variable_id SET NOT NULL;

ALTER TABLE environment_user_values
  DROP COLUMN IF EXISTS variable_key;

ALTER TABLE environment_user_values
  DROP COLUMN IF EXISTS environment_id;

-- STEP 7: Add unique constraint for user values
ALTER TABLE environment_user_values
  DROP CONSTRAINT IF EXISTS environment_user_values_variable_user_unique;

ALTER TABLE environment_user_values
  ADD CONSTRAINT environment_user_values_variable_user_unique
  UNIQUE (variable_id, user_id);

-- STEP 8: Drop the old JSON column from environments
ALTER TABLE environments DROP COLUMN IF EXISTS variables;

-- STEP 9: Enable RLS on new table
ALTER TABLE environment_variables ENABLE ROW LEVEL SECURITY;

-- STEP 10: RLS policies for environment_variables
-- Users can view variables in environments they have access to
CREATE POLICY "Users can view environment variables in their workspaces"
ON environment_variables FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
  )
);

-- Admins can manage variables
CREATE POLICY "Admins can insert environment variables"
ON environment_variables FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role = 'admin'
  )
);

CREATE POLICY "Admins can update environment variables"
ON environment_variables FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role = 'admin'
  )
);

CREATE POLICY "Admins can delete environment variables"
ON environment_variables FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM environments e
    JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE e.id = environment_variables.environment_id
    AND wm.user_id = auth.uid()
    AND up.role = 'admin'
  )
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_environment_variables_environment_id
ON environment_variables(environment_id);

CREATE INDEX IF NOT EXISTS idx_environment_user_values_variable_id
ON environment_user_values(variable_id);
