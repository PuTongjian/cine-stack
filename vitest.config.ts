import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    setupFiles: ['tests/helpers/browser-setup.ts'],
    include: ['tests/**/*.test.{ts,tsx,mjs}'],
    environment: 'node',
    env: { NODE_ENV: 'test' },
  },
})
