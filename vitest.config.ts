import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@cli': resolve(__dirname, 'src/cli'),
      '@server': resolve(__dirname, 'src/server'),
      '@client': resolve(__dirname, 'src/client'),
    },
  },
});
