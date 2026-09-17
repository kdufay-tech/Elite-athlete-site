import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Tests are pure-logic only (no DOM), so the default node environment is
  // right. include is explicit so the _pulled_aside/ backup tree and the
  // Python tooling under tools/ can never be picked up as suites.
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
  server: {
    port: 3000,
    open: 'http://localhost:3000',
    host: 'localhost'
  }
})
