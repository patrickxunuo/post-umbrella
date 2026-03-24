// Supabase Client Configuration
import { createClient } from '@supabase/supabase-js';

// Get config from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
});

// Proxy endpoint URL (Supabase Edge Function)
export const PROXY_FUNCTION_URL = import.meta.env.VITE_SUPABASE_PROXY_URL || `${supabaseUrl}/functions/v1/proxy`;
