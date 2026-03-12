-- Drop the legacy collection_id column from user_active_environment
-- We now use workspace_id instead

ALTER TABLE user_active_environment DROP COLUMN IF EXISTS collection_id;
