-- Data migration: Create Default Workspace and migrate existing data
-- This runs after the workspace schema is created

-- Create the Default Workspace
INSERT INTO workspaces (id, name, description, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Workspace',
  'Automatically created workspace for existing collections',
  EXTRACT(EPOCH FROM NOW())::BIGINT,
  EXTRACT(EPOCH FROM NOW())::BIGINT
)
ON CONFLICT (id) DO NOTHING;

-- Update all existing top-level collections to belong to Default Workspace
UPDATE collections
SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE parent_id IS NULL AND workspace_id IS NULL;

-- Create user_profiles for all existing users (as active admins for migration)
INSERT INTO user_profiles (user_id, role, status, invited_at, activated_at, created_at, updated_at)
SELECT
  id,
  'admin',
  'active',
  EXTRACT(EPOCH FROM NOW())::BIGINT,
  EXTRACT(EPOCH FROM NOW())::BIGINT,
  EXTRACT(EPOCH FROM NOW())::BIGINT,
  EXTRACT(EPOCH FROM NOW())::BIGINT
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- Add all existing users as members of the Default Workspace
INSERT INTO workspace_members (workspace_id, user_id, created_at)
SELECT
  '00000000-0000-0000-0000-000000000001',
  id,
  EXTRACT(EPOCH FROM NOW())::BIGINT
FROM auth.users
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Set Default Workspace as active for all existing users
INSERT INTO user_active_workspace (user_id, workspace_id)
SELECT
  id,
  '00000000-0000-0000-0000-000000000001'
FROM auth.users
ON CONFLICT (user_id) DO UPDATE SET workspace_id = '00000000-0000-0000-0000-000000000001';
