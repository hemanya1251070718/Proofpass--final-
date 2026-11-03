import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// NOTE: no GitHub token is injected into the browser bundle. GITHUB_TOKEN is backend-only.
export default defineConfig(() => {
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
