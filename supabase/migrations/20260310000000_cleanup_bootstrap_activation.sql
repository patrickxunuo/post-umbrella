-- Cleanup activation flow:
-- 1. bootstrap_or_activate_user only handles existing invited users
-- 2. first-user admin bootstrap is no longer part of the login path
-- 3. email is synced from auth.users when missing

CREATE OR REPLACE FUNCTION bootstrap_or_activate_user()
RETURNS JSON AS $$
DECLARE
  current_uid UUID;
  current_email TEXT;
  existing_profile RECORD;
  now_ts BIGINT;
BEGIN
  current_uid := auth.uid();
  now_ts := EXTRACT(EPOCH FROM NOW())::BIGINT;

  IF current_uid IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'action', 'unauthorized',
      'message', 'Not authenticated'
    );
  END IF;

  SELECT email INTO current_email
  FROM auth.users
  WHERE id = current_uid;

  SELECT * INTO existing_profile
  FROM user_profiles
  WHERE user_id = current_uid;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'action', 'unauthorized',
      'message', 'User not authorized. Please contact an administrator to be invited.'
    );
  END IF;

  IF existing_profile.status = 'pending' THEN
    UPDATE user_profiles
    SET
      status = 'active',
      email = COALESCE(user_profiles.email, current_email),
      activated_at = now_ts,
      updated_at = now_ts
    WHERE user_id = current_uid;

    RETURN json_build_object(
      'success', true,
      'action', 'activated',
      'profile', json_build_object(
        'user_id', current_uid,
        'email', COALESCE(existing_profile.email, current_email),
        'role', existing_profile.role,
        'status', 'active'
      )
    );
  END IF;

  IF existing_profile.status = 'disabled' THEN
    RETURN json_build_object(
      'success', false,
      'action', 'disabled',
      'message', 'Account is disabled'
    );
  END IF;

  UPDATE user_profiles
  SET
    email = COALESCE(user_profiles.email, current_email),
    updated_at = CASE
      WHEN user_profiles.email IS NULL AND current_email IS NOT NULL THEN now_ts
      ELSE user_profiles.updated_at
    END
  WHERE user_id = current_uid
    AND user_profiles.email IS NULL
    AND current_email IS NOT NULL;

  RETURN json_build_object(
    'success', true,
    'action', 'none',
    'profile', json_build_object(
      'user_id', current_uid,
      'email', COALESCE(existing_profile.email, current_email),
      'role', existing_profile.role,
      'status', existing_profile.status
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
