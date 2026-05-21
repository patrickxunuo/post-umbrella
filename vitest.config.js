import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom provides localStorage for store tests; pure-helper tests run fine in it too.
    environment: 'jsdom',
    globals: true,
    // Unit tests live next to source as *.test.js; keep Playwright's e2e/ specs out.
    include: ['src/**/*.test.{js,jsx}'],
  },
});
