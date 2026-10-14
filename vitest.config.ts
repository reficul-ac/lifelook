import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      { test: { name: 'engine', environment: 'node', include: ['tests/engine/**/*.test.ts'] } },
      { test: { name: 'browser', environment: 'jsdom', include: ['tests/browser/**/*.test.ts'], setupFiles: ['tests/browser/setup.ts'] } },
    ],
  },
});
