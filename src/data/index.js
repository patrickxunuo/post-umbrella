// Data Layer - Provider Switcher
// This module exports the active data provider.
// Change the import to switch between Express (current) and Supabase.

// Express provider (MySQL backend) - uncomment to use:
// export * from './express/index.js';

// Supabase provider (PostgreSQL + Realtime + Auth)
export * from './supabase/index.js';
