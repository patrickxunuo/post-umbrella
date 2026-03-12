-- Migration: Add email column to user_profiles and create login check function
-- This enables restricting magic link requests to only registered users

-- Add email column to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- Update existing profiles with email from auth.users
UPDATE user_profiles up
SET email = au.email
FROM auth.users au
WHERE up.user_id = au.id AND up.email IS NULL;

-- Function to check if an email is allowed to login (can be called without authentication)
-- Returns: { allowed: boolean, status: string | null, message: string }
CREATE OR REPLACE FUNCTION check_email_allowed(check_email TEXT)
RETURNS JSON AS $$
DECLARE
  profile_record RECORD;
BEGIN
  -- Look up the profile by email (case-insensitive)
  SELECT status INTO profile_record
  FROM user_profiles
  WHERE LOWER(email) = LOWER(check_email);

  IF NOT FOUND THEN
    RETURN json_build_object(
      'allowed', false,
      'status', null,
      'message', 'This email is not registered. Please contact an administrator to get invited.'
    );
  END IF;

  IF profile_record.status = 'disabled' THEN
    RETURN json_build_object(
      'allowed', false,
      'status', 'disabled',
      'message', 'Your account has been disabled. Please contact an administrator.'
    );
  END IF;

  -- Status is 'pending' or 'active' - both are allowed to login
  RETURN json_build_object(
    'allowed', true,
    'status', profile_record.status,
    'message', null
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to anonymous users (needed for pre-login check)
GRANT EXECUTE ON FUNCTION check_email_allowed(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION check_email_allowed(TEXT) TO authenticated;
