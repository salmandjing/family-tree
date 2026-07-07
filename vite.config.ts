/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Base path: GitHub Pages serves the app under /tree (per spec §1).
// Override at build time with VITE_BASE=/ for local/subdomain deploys.
const base = process.env.VITE_BASE ?? '/tree/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // Vitest owns tests/; Playwright owns e2e/ (run via `npm run e2e`).
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/core/**',
        'src/store/**',
        'src/sync/**',
        'src/render/**',
        'src/app/**',
        'worker/src/**',
      ],
      exclude: ['src/app/**/*.tsx'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
