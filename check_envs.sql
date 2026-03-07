-- Check environments table structure
DESCRIBE environments;

-- Check all environments (should show all, not filtered by user)
SELECT id, name, created_by, 
       (SELECT email FROM users WHERE id = environments.created_by) as creator_email 
FROM environments;

-- Check user_active_environment table
SELECT * FROM user_active_environment;
