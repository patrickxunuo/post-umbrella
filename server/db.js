import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'post_umbrella',
};

let pool = null;

// Initialize database
export async function initDb() {
  // First connect without database to create it if needed
  const tempConnection = await mysql.createConnection({
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
  });

  // Create database if not exists
  await tempConnection.execute(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\``);
  await tempConnection.end();

  // Create connection pool
  pool = mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Create tables
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS collections (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      parent_id VARCHAR(36),
      created_at INT DEFAULT (UNIX_TIMESTAMP()),
      updated_at INT DEFAULT (UNIX_TIMESTAMP()),
      FOREIGN KEY (parent_id) REFERENCES collections(id) ON DELETE CASCADE
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS requests (
      id VARCHAR(36) PRIMARY KEY,
      collection_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      method VARCHAR(10) DEFAULT 'GET',
      url TEXT,
      headers TEXT,
      body LONGTEXT,
      body_type VARCHAR(20) DEFAULT 'none',
      created_at INT DEFAULT (UNIX_TIMESTAMP()),
      updated_at INT DEFAULT (UNIX_TIMESTAMP()),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS examples (
      id VARCHAR(36) PRIMARY KEY,
      request_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      request_data LONGTEXT,
      response_data LONGTEXT,
      created_at INT DEFAULT (UNIX_TIMESTAMP()),
      FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
    )
  `);

  // Add auth columns to requests table if they don't exist
  try {
    await pool.execute(`ALTER TABLE requests ADD COLUMN auth_type VARCHAR(20) DEFAULT 'none'`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    await pool.execute(`ALTER TABLE requests ADD COLUMN auth_token TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  // Add sort_order column to requests table if it doesn't exist
  try {
    await pool.execute(`ALTER TABLE requests ADD COLUMN sort_order INT DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  // Add form_data column to requests table if it doesn't exist
  try {
    await pool.execute(`ALTER TABLE requests ADD COLUMN form_data LONGTEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  // Add params column to requests table if it doesn't exist
  try {
    await pool.execute(`ALTER TABLE requests ADD COLUMN params LONGTEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  // Add pre_script column to requests table if it doesn't exist
  try {
    await pool.execute(`ALTER TABLE requests ADD COLUMN pre_script LONGTEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  // Add post_script column to requests table if it doesn't exist
  try {
    await pool.execute(`ALTER TABLE requests ADD COLUMN post_script LONGTEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Users table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      created_at INT DEFAULT (UNIX_TIMESTAMP())
    )
  `);

  // Environments table (collection-specific)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS environments (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      variables LONGTEXT,
      collection_id VARCHAR(36),
      created_by VARCHAR(36),
      updated_by VARCHAR(36),
      created_at INT DEFAULT (UNIX_TIMESTAMP()),
      updated_at INT DEFAULT (UNIX_TIMESTAMP()),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // User active environment table (tracks which env is active for each user per collection)
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS user_active_environment (
        user_id VARCHAR(36) NOT NULL,
        collection_id VARCHAR(36) NOT NULL,
        environment_id VARCHAR(36),
        PRIMARY KEY (user_id, collection_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
        FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE SET NULL
      )
    `);
    console.log('user_active_environment table ready');
  } catch (e) {
    console.error('Failed to create user_active_environment table:', e.message);
  }

  // Migration: Add collection_id column to environments if it doesn't exist
  try {
    await pool.execute(`ALTER TABLE environments ADD COLUMN collection_id VARCHAR(36)`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: Add collection_id column to user_active_environment if table has old structure
  try {
    await pool.execute(`ALTER TABLE user_active_environment ADD COLUMN collection_id VARCHAR(36) NOT NULL`);
    // Drop old primary key and add new composite primary key
    await pool.execute(`ALTER TABLE user_active_environment DROP PRIMARY KEY`);
    await pool.execute(`ALTER TABLE user_active_environment ADD PRIMARY KEY (user_id, collection_id)`);
  } catch (e) {
    // Column already exists or migration already done
  }

  // Migration: Add created_by column if it doesn't exist (for existing databases)
  try {
    await pool.execute(`ALTER TABLE environments ADD COLUMN created_by VARCHAR(36)`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    await pool.execute(`ALTER TABLE environments ADD COLUMN updated_by VARCHAR(36)`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: Copy user_id to created_by if user_id exists
  try {
    await pool.execute(`UPDATE environments SET created_by = user_id WHERE created_by IS NULL AND user_id IS NOT NULL`);
  } catch (e) {
    // user_id column doesn't exist or migration already done
  }

  // Migration: Drop user_id and is_active columns if they exist
  try {
    await pool.execute(`ALTER TABLE environments DROP FOREIGN KEY environments_ibfk_1`);
  } catch (e) {
    // Foreign key doesn't exist
  }
  try {
    await pool.execute(`ALTER TABLE environments DROP COLUMN user_id`);
  } catch (e) {
    // Column doesn't exist
  }
  try {
    await pool.execute(`ALTER TABLE environments DROP COLUMN is_active`);
  } catch (e) {
    // Column doesn't exist
  }

  // Sessions table (persistent tokens)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      created_at INT DEFAULT (UNIX_TIMESTAMP()),
      expires_at INT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  console.log('MySQL database initialized');
  return pool;
}

// Helper to run a query and return all results
export async function all(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// Helper to run a query and return first result
export async function get(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
}

// Helper to run a query (insert/update/delete)
export async function run(sql, params = []) {
  await pool.execute(sql, params);
}

export default { initDb, all, get, run };
