import { defineConfig } from 'vitest/config';

// Two suites: `unit` (Node, pure game logic against the extracted data) and `e2e` (the real game in
// headless Chrome, driven through window.__test). See tests/README.md.
export default defineConfig({
  test: {
    // Each e2e file drives its own headless Chrome, and software rendering is CPU-heavy.
    maxWorkers: 4,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/unit/setup.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/e2e/globalSetup.ts'],
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
