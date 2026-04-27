-- ============================================
-- Request Path Variables
-- Add path_variables JSONB column to requests
-- to support :name path-variable substitution
-- ============================================

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS path_variables JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN requests.path_variables IS
  'Path variables declared inline in url via :name syntax. Array of {key, value}, order matches URL order.';
