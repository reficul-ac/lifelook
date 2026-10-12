import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'engine', environment: 'node', include: ['tests/engine/**/*.test.ts'] } },
      { test: { name: 'browser', environment: 'jsdom', include: ['tests/browser/**/*.test.ts'], setupFiles: ['tests/browser/setup.ts'] } },
    ],
  },
});
