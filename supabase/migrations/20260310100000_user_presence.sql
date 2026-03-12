-- Add columns for user presence tracking
-- display_name: optional display name for user
-- avatar_url: optional avatar image URL
-- last_seen: unix timestamp of last activity (updated every 60s while online)

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS display_name TEXT,
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS last_seen BIGINT;

-- Create index on last_seen for efficient sorting
CREATE INDEX IF NOT EXISTS idx_user_profiles_last_seen ON user_profiles(last_seen DESC);
