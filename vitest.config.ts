import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects: the server tests in node, the React dashboard in jsdom.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', include: ['test/**/*.test.ts'], environment: 'node' } },
      {
        plugins: [react()],
        test: { name: 'web', include: ['web/src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['web/src/test/setup.ts'] },
      },
    ],
  },
});
