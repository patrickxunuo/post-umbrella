-- Persistent MCP sessions: survives server restarts
CREATE TABLE mcp_sessions (
  token         TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  expires_at    BIGINT NOT NULL,
  created_at    BIGINT NOT NULL DEFAULT extract(epoch FROM now())::bigint,
  last_used_at  BIGINT NOT NULL DEFAULT extract(epoch FROM now())::bigint
);

ALTER TABLE mcp_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: only service role can access (protects refresh tokens)
