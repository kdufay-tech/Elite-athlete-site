import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // ── P3 Security Fix: Disable source maps in production ──
  build: {
    sourcemap: false
  },
  server: {
    port: 3000,
    open: 'http://localhost:3000',
    host: 'localhost'
  }
})
