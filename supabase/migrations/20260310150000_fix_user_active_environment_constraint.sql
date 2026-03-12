-- Fix: Add unique constraint for user_active_environment upsert
-- The upsert on (user_id, workspace_id) requires a unique constraint, not just an index

-- Drop the existing index if it exists (we'll replace with unique constraint)
DROP INDEX IF EXISTS idx_user_active_environment_user_workspace;

-- Add unique constraint on (user_id, workspace_id)
ALTER TABLE user_active_environment
  DROP CONSTRAINT IF EXISTS user_active_environment_user_workspace_unique;

ALTER TABLE user_active_environment
  ADD CONSTRAINT user_active_environment_user_workspace_unique
  UNIQUE (user_id, workspace_id);
