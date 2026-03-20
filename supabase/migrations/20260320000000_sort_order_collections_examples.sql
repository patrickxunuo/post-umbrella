-- Add sort_order to collections (for folder reordering)
ALTER TABLE collections ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- Add sort_order to examples (for example reordering)
ALTER TABLE examples ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- Backfill folders: match current display order (created_at ASC within each parent)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY created_at ASC) - 1 AS rn
  FROM collections
  WHERE parent_id IS NOT NULL
)
UPDATE collections SET sort_order = ranked.rn FROM ranked WHERE collections.id = ranked.id;

-- Backfill examples: match current display order (created_at DESC within each request)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY created_at DESC) - 1 AS rn
  FROM examples
)
UPDATE examples SET sort_order = ranked.rn FROM ranked WHERE examples.id = ranked.id;
