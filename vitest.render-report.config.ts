// Runs the render report, which `npm test` leaves out. See the render report
// in docs/panel-architecture.md.
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const RECORDER = fileURLToPath(
  new URL("tests/ui/render-audit/render-recorder.ts", import.meta.url),
);

// The forms panel components are declared in. The report misses others.
const DECLARATION =
  /^(?:export )?(?:function (?=[A-Z])|const (?=[A-Z]\w* = (?:memo|forwardRef)\b))(\w+)/gm;

/**
 * Registers every component a panel module declares, exported or not, so the
 * report can tell our components from third-party ones.
 */
function registerPanelComponents(): Plugin {
  return {
    name: "register-panel-components",
    enforce: "pre",
    transform(code, id) {
      const [file = id] = id.split("?");

      if (
        !/\/src\/panel\/.+\.tsx$/.test(file) ||
        /(\.test|-test-harness)\.tsx$/.test(file)
      ) {
        return undefined;
      }

      const names = [...code.matchAll(DECLARATION)].map(([, name]) => name);

      if (!names.length) return undefined;

      const registrations = names.map((name) => `register(${name});`);

      return {
        code: [
          code,
          `import { registerComponent as register } from ${JSON.stringify(RECORDER)};`,
          ...registrations,
        ].join("\n"),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), registerPanelComponents()],
  test: {
    include: ["tests/ui/render-audit/render-report.report.ts"],
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://localhost/", pretendToBeVisual: true },
    },
    restoreMocks: true,
    testTimeout: 60_000,
  },
});
