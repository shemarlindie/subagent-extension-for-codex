// Test runner config. Kept separate from vite.config.ts, whose root is the
// panel dev host. Tests run in node; React tests opt into jsdom per file with
// a `// @vitest-environment jsdom` comment.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const integration = [
  "tests/integration/**/*.test.ts",
  "src/**/*.integration.test.ts",
];

const dom = ["tests/ui/**/*.test.ts", "src/**/*.test.tsx"];

// Unit tests fail fast: a stall should surface in seconds. Integration suites
// spawn processes and Git worktrees, so they keep a longer limit.
const unitTimeout = 15_000;
const integrationTimeout = 60_000;

export default defineConfig({
  plugins: [react()],
  test: {
    pool: "threads",
    fsModuleCache: true,
    environmentOptions: {
      jsdom: { url: "http://localhost/", pretendToBeVisual: true },
    },
    // Undo vi.spyOn and vi.stubEnv after each test, like node:test's t.mock.
    restoreMocks: true,
    unstubEnvs: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "tests/**/*.test.ts",
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "dev/**/*.test.ts",
            "dev/**/*.test.tsx",
          ],
          exclude: [...integration, ...dom, "**/node_modules/**"],
          environment: "node",
          testTimeout: unitTimeout,
          hookTimeout: unitTimeout,
        },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          include: dom,
          // Reuse the worker while each file keeps its own DOM and module scope.
          pool: "vmThreads",
          vmMemoryLimit: "512MB",
          environment: "jsdom",
          testTimeout: unitTimeout,
          hookTimeout: unitTimeout,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: integration,
          environment: "node",
          testTimeout: integrationTimeout,
          hookTimeout: integrationTimeout,
        },
      },
    ],
  },
});
