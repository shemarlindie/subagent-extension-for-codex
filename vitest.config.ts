// Test runner config. Kept separate from vite.config.ts, whose root is the
// panel dev host. Tests run in node; React tests opt into jsdom per file with
// a `// @vitest-environment jsdom` comment.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      "tests/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "dev/**/*.test.ts",
      "dev/**/*.test.tsx",
    ],
    environment: "node",
    environmentOptions: {
      jsdom: { url: "http://localhost/", pretendToBeVisual: true },
    },
    // Integration tests spawn processes and Git worktrees.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Undo vi.spyOn and vi.stubEnv after each test, like node:test's t.mock.
    restoreMocks: true,
    unstubEnvs: true,
  },
});
