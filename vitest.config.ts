import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['tests/main/**/*.test.{js,ts}'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'renderer',
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['tests/renderer/setup.ts'],
        },
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src/renderer/src'),
          },
        },
      },
    ],
  },
});
