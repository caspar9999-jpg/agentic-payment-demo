import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
  server: {
    proxy: {
      '/x402': { target: 'http://localhost:3002', rewrite: path => path.replace(/^\/x402/, '') },
      '/bazaar': { target: 'http://localhost:3001', rewrite: path => path.replace(/^\/bazaar/, '') },
    },
  },
})
