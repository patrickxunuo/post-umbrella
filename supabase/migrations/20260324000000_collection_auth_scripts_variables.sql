-- ============================================
-- Collection Tabs: Auth, Scripts, Variables
-- Add auth/script fields to collections,
-- create collection_variables table with
-- per-user current values
-- ============================================

-- STEP 1: Add auth and script columns to collections
ALTER TABLE collections ADD COLUMN IF NOT EXISTS auth_type VARCHAR(20) DEFAULT 'none';
ALTER TABLE collections ADD COLUMN IF NOT EXISTS auth_token TEXT DEFAULT '';
ALTER TABLE collections ADD COLUMN IF NOT EXISTS pre_script TEXT DEFAULT '';
ALTER TABLE collections ADD COLUMN IF NOT EXISTS post_script TEXT DEFAULT '';
ALTER TABLE collections ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- STEP 2: Create collection_variables table (similar to environment_variables)
CREATE TABLE IF NOT EXISTS collection_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  initial_value TEXT DEFAULT '',
  enabled BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE(collection_id, key)
);

-- STEP 3: Create per-user current values for collection variables
CREATE TABLE IF NOT EXISTS collection_variable_user_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variable_id UUID NOT NULL REFERENCES collection_variables(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_value TEXT DEFAULT '',
  UNIQUE(variable_id, user_id)
);

-- STEP 4: Indexes
CREATE INDEX IF NOT EXISTS idx_collection_variables_collection_id
ON collection_variables(collection_id);

CREATE INDEX IF NOT EXISTS idx_collection_variable_user_values_variable_id
ON collection_variable_user_values(variable_id);

CREATE INDEX IF NOT EXISTS idx_collection_variable_user_values_user_id
ON collection_variable_user_values(user_id);

-- STEP 5: Enable RLS
ALTER TABLE collection_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_variable_user_values ENABLE ROW LEVEL SECURITY;

-- STEP 6: RLS policies for collection_variables
-- All workspace members can view
CREATE POLICY "Workspace members can view collection variables"
ON collection_variables FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM collections c
    JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
    WHERE c.id = collection_variables.collection_id
    AND wm.user_id = auth.uid()
  )
);

-- Developers+ can manage
CREATE POLICY "Developers can insert collection variables"
ON collection_variables FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM collections c
    JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE c.id = collection_variables.collection_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('developer', 'admin', 'system')
  )
);

CREATE POLICY "Developers can update collection variables"
ON collection_variables FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM collections c
    JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE c.id = collection_variables.collection_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('developer', 'admin', 'system')
  )
);

CREATE POLICY "Developers can delete collection variables"
ON collection_variables FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM collections c
    JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
    JOIN user_profiles up ON up.user_id = wm.user_id
    WHERE c.id = collection_variables.collection_id
    AND wm.user_id = auth.uid()
    AND up.role IN ('developer', 'admin', 'system')
  )
);

-- STEP 7: RLS policies for collection_variable_user_values
-- Users can manage their own current values
CREATE POLICY "Users can manage their own collection variable values"
ON collection_variable_user_values FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- STEP 8: Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE collection_variables;
ALTER PUBLICATION supabase_realtime ADD TABLE collection_variable_user_values;

-- STEP 9: Backfill created_by for existing collections from workspace owner
-- (best-effort: set to first admin member of the workspace)
UPDATE collections c
SET created_by = (
  SELECT wm.user_id FROM workspace_members wm
  JOIN user_profiles up ON up.user_id = wm.user_id
  WHERE wm.workspace_id = c.workspace_id
  AND up.role IN ('admin', 'system')
  ORDER BY wm.created_at ASC
  LIMIT 1
)
WHERE c.created_by IS NULL;
