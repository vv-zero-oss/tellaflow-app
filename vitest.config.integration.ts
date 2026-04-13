import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.{js,ts}'],
    environment: 'node',
    testTimeout: 120_000,
    reporters: ['verbose'],
  },
});
