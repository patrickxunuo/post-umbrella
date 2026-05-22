import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom provides localStorage for store tests; pure-helper tests run fine in it too.
    environment: 'jsdom',
    globals: true,
    // Dummy Supabase creds so importing component modules (which transitively pull in
    // the Supabase client) doesn't throw at import time during unit tests.
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    // Unit tests live next to source as *.test.js; keep Playwright's e2e/ specs out.
    include: ['src/**/*.test.{js,jsx}'],
  },
});
