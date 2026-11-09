import { defineConfig } from 'vite';
import { defineConfig as defineVitestConfig } from 'vitest/config';

export default defineVitestConfig({
  server: { host: '0.0.0.0', port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
