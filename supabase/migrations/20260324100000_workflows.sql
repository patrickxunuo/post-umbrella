-- ============================================
-- Workflows: Reusable API request flows
-- Collection-scoped, user-visible to all workspace members
-- ============================================

CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'New Workflow',
  steps JSONB NOT NULL DEFAULT '[]',
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
);

-- RLS
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

-- All workspace members can view workflows in their collections
CREATE POLICY "Members can view workflows" ON workflows
  FOR SELECT TO authenticated
  USING (
    collection_id IN (
      SELECT id FROM collections WHERE workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    )
  );

CREATE POLICY "Developers can create workflows" ON workflows
  FOR INSERT TO authenticated
  WITH CHECK (
    can_edit(auth.uid())
    AND collection_id IN (
      SELECT id FROM collections WHERE workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    )
  );

CREATE POLICY "Developers can update workflows" ON workflows
  FOR UPDATE TO authenticated
  USING (
    can_edit(auth.uid())
    AND collection_id IN (
      SELECT id FROM collections WHERE workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    )
  )
  WITH CHECK (true);

CREATE POLICY "Developers can delete workflows" ON workflows
  FOR DELETE TO authenticated
  USING (
    can_edit(auth.uid())
    AND collection_id IN (
      SELECT id FROM collections WHERE workspace_id IN (SELECT get_user_workspace_ids(auth.uid()))
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE workflows;
