-- Supabase Schema for Post Umbrella
-- Run this in the Supabase SQL Editor to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Collections table
CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  parent_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Requests table
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  method VARCHAR(10) DEFAULT 'GET',
  url TEXT,
  headers TEXT,
  body TEXT,
  body_type VARCHAR(20) DEFAULT 'none',
  form_data TEXT,
  params TEXT,
  auth_type VARCHAR(20) DEFAULT 'none',
  auth_token TEXT,
  pre_script TEXT,
  post_script TEXT,
  sort_order INT DEFAULT 0,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Examples table
CREATE TABLE IF NOT EXISTS examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  request_data TEXT,
  response_data TEXT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Environments table (collection-specific)
CREATE TABLE IF NOT EXISTS environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  variables TEXT,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- User active environment table (per user per collection)
CREATE TABLE IF NOT EXISTS user_active_environment (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES environments(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, collection_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_collections_parent_id ON collections(parent_id);
CREATE INDEX IF NOT EXISTS idx_requests_collection_id ON requests(collection_id);
CREATE INDEX IF NOT EXISTS idx_examples_request_id ON examples(request_id);
CREATE INDEX IF NOT EXISTS idx_environments_collection_id ON environments(collection_id);

-- Enable Row Level Security (RLS)
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_active_environment ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow authenticated users full access
-- Collections
CREATE POLICY "Authenticated users can read collections"
  ON collections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert collections"
  ON collections FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update collections"
  ON collections FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete collections"
  ON collections FOR DELETE
  TO authenticated
  USING (true);

-- Requests
CREATE POLICY "Authenticated users can read requests"
  ON requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert requests"
  ON requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update requests"
  ON requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete requests"
  ON requests FOR DELETE
  TO authenticated
  USING (true);

-- Examples
CREATE POLICY "Authenticated users can read examples"
  ON examples FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert examples"
  ON examples FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update examples"
  ON examples FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete examples"
  ON examples FOR DELETE
  TO authenticated
  USING (true);

-- Environments
CREATE POLICY "Authenticated users can read environments"
  ON environments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert environments"
  ON environments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update environments"
  ON environments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete environments"
  ON environments FOR DELETE
  TO authenticated
  USING (true);

-- User active environment
CREATE POLICY "Users can manage their own active environments"
  ON user_active_environment FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable Realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE collections;
ALTER PUBLICATION supabase_realtime ADD TABLE requests;
ALTER PUBLICATION supabase_realtime ADD TABLE examples;
ALTER PUBLICATION supabase_realtime ADD TABLE environments;
