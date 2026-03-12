-- Migration: Environment Variables Workspace Scope with Initial/Current Values
-- This migration refactors environments from collection-scoped to workspace-scoped
-- and adds support for Initial Value (shared) and Current Value (private) pattern

-- ============================================
-- STEP 1: Add workspace_id to environments
-- ============================================

-- Add workspace_id column (nullable initially for migration)
ALTER TABLE environments ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- Migrate existing environments: find workspace via collection
UPDATE environments e
SET workspace_id = c.workspace_id
FROM collections c
WHERE e.collection_id = c.id
  AND e.workspace_id IS NULL
  AND c.workspace_id IS NOT NULL;

-- For environments with collection_id but no workspace found (orphaned collections),
-- try to find workspace through parent chain
UPDATE environments e
SET workspace_id = (
  WITH RECURSIVE collection_chain AS (
    SELECT id, parent_id, workspace_id
    FROM collections
    WHERE id = e.collection_id
    UNION ALL
    SELECT c.id, c.parent_id, c.workspace_id
    FROM collections c
    INNER JOIN collection_chain cc ON c.id = cc.parent_id
  )
  SELECT workspace_id FROM collection_chain WHERE workspace_id IS NOT NULL LIMIT 1
)
WHERE e.workspace_id IS NULL AND e.collection_id IS NOT NULL;

-- ============================================
-- STEP 2: Create environment_user_values table
-- ============================================

CREATE TABLE IF NOT EXISTS environment_user_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variable_key VARCHAR(255) NOT NULL,
  current_value TEXT,
  updated_at INT DEFAULT EXTRACT(EPOCH FROM NOW())::INT,
  UNIQUE (environment_id, user_id, variable_key)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_env_user_values_env_user
ON environment_user_values(environment_id, user_id);

-- Enable RLS on the new table
ALTER TABLE environment_user_values ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own current values
CREATE POLICY "Users can view their own current values"
ON environment_user_values FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own current values"
ON environment_user_values FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own current values"
ON environment_user_values FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own current values"
ON environment_user_values FOR DELETE
USING (auth.uid() = user_id);

-- ============================================
-- STEP 3: Update user_active_environment
-- ============================================

-- Add workspace_id column
ALTER TABLE user_active_environment ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- Migrate: Set workspace_id from environment's workspace
UPDATE user_active_environment uae
SET workspace_id = e.workspace_id
FROM environments e
WHERE uae.environment_id = e.id
  AND uae.workspace_id IS NULL
  AND e.workspace_id IS NOT NULL;

-- For records without environment_id, try to get workspace from collection
UPDATE user_active_environment uae
SET workspace_id = c.workspace_id
FROM collections c
WHERE uae.collection_id = c.id
  AND uae.workspace_id IS NULL
  AND c.workspace_id IS NOT NULL;

-- ============================================
-- STEP 4: Create new constraint and indexes
-- ============================================

-- Create unique constraint for user + workspace (after data migration)
-- Note: We keep collection_id for backward compatibility during transition
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_active_env_workspace
ON user_active_environment(user_id, workspace_id)
WHERE workspace_id IS NOT NULL;

-- Index for environment lookups by workspace
CREATE INDEX IF NOT EXISTS idx_environments_workspace
ON environments(workspace_id);

-- ============================================
-- STEP 5: Helper function to get merged variables
-- ============================================

-- Function to get environment variables with current values merged
CREATE OR REPLACE FUNCTION get_environment_with_current_values(env_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  env_record RECORD;
  variables_array JSONB;
  user_values JSONB;
  merged_variables JSONB;
  var_item JSONB;
  current_val TEXT;
BEGIN
  -- Get the environment
  SELECT * INTO env_record FROM environments WHERE id = env_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Parse variables
  variables_array := COALESCE(env_record.variables::JSONB, '[]'::JSONB);

  -- Get user's current values as a key-value map
  SELECT COALESCE(
    jsonb_object_agg(variable_key, current_value),
    '{}'::JSONB
  ) INTO user_values
  FROM environment_user_values
  WHERE environment_id = env_id AND user_id = auth.uid();

  -- Merge current values into variables
  merged_variables := '[]'::JSONB;
  FOR var_item IN SELECT * FROM jsonb_array_elements(variables_array)
  LOOP
    current_val := user_values ->> (var_item ->> 'key');
    merged_variables := merged_variables || jsonb_build_array(
      var_item || jsonb_build_object(
        'initial_value', var_item ->> 'value',
        'current_value', COALESCE(current_val, var_item ->> 'value')
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', env_record.id,
    'name', env_record.name,
    'workspace_id', env_record.workspace_id,
    'collection_id', env_record.collection_id,
    'variables', merged_variables,
    'created_by', env_record.created_by,
    'updated_by', env_record.updated_by,
    'created_at', env_record.created_at,
    'updated_at', env_record.updated_at
  );
END;
$$;

-- ============================================
-- CLEANUP (Run after verifying migration)
-- ============================================

-- These commands should be run AFTER verifying the migration worked:
--
-- -- Drop old collection_id foreign key from environments
-- ALTER TABLE environments DROP CONSTRAINT IF EXISTS environments_collection_id_fkey;
--
-- -- Make workspace_id NOT NULL (after all data migrated)
-- ALTER TABLE environments ALTER COLUMN workspace_id SET NOT NULL;
--
-- -- Drop collection_id from environments
-- ALTER TABLE environments DROP COLUMN IF EXISTS collection_id;
--
-- -- Drop collection_id from user_active_environment
-- ALTER TABLE user_active_environment DROP COLUMN IF EXISTS collection_id;
--
-- -- Update primary key for user_active_environment
-- ALTER TABLE user_active_environment DROP CONSTRAINT IF EXISTS user_active_environment_pkey;
-- ALTER TABLE user_active_environment ADD PRIMARY KEY (user_id, workspace_id);
