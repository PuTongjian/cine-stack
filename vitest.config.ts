import { defineConfig } from 'vitest/config';
export default defineConfig({ esbuild: { jsx: 'automatic' }, test: { include: ['packages/**/*.test.mjs', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'], environment: 'node', env: { NODE_ENV: 'test' } } });
