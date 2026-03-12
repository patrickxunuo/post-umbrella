import { defineConfig } from 'vite'
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import react from '@vitejs/plugin-react'

function getBuildVersion() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

const buildVersion = getBuildVersion()
writeFileSync('public/version.json', JSON.stringify({ version: buildVersion }))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  server: {
    allowedHosts: ['post-umbrealla.ngrok.io'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy Supabase requests to avoid CORS in local dev
      '/supabase': {
        target: 'http://localhost:54321',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''),
      },
    },
  },
})
