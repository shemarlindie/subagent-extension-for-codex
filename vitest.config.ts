// Test runner config. Kept separate from vite.config.ts, whose root is the
// panel dev host. React tests set up their own JSDOM, so the environment is node.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Integration tests spawn processes and Git worktrees.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Undo vi.spyOn and vi.stubEnv after each test, like node:test's t.mock.
    restoreMocks: true,
    unstubEnvs: true,
  },
});
