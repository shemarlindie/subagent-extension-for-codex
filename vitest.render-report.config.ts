// Runs the render report, which `npm test` leaves out. See the render report
// in docs/panel-architecture.md.
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const RECORDER = fileURLToPath(
  new URL("tests/ui/render-audit/render-recorder.ts", import.meta.url),
);

// The AST `this.parse` returns, taken from Vite's plugin types.
type TransformHook = Extract<
  NonNullable<Plugin["transform"]>,
  (...args: never) => unknown
>;

type Program = ReturnType<ThisParameterType<TransformHook>["parse"]>;

type Statement = Program["body"][number];

type Value = Extract<
  Statement,
  { type: "VariableDeclaration" }
>["declarations"][number]["init"];

const isComponentName = (name: string) => /^[A-Z]/.test(name);

/** Whether a variable's value is a component: a function or a `memo` of one. */
function isComponentValue(value: Value) {
  if (
    value?.type === "ArrowFunctionExpression" ||
    value?.type === "FunctionExpression"
  ) {
    return true;
  }

  if (value?.type !== "CallExpression") return false;
  // `memo(…)` or `React.memo(…)`.
  const { callee } = value;
  const name = callee.type === "MemberExpression" ? callee.property : callee;

  return name.type === "Identifier" && name.name === "memo";
}

/** Names of the components a module declares at its top level. */
function componentNames(program: Program) {
  return program.body.flatMap((statement) => {
    const declaration =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;

    if (declaration?.type === "FunctionDeclaration") {
      const name = declaration.id?.name;

      return name && isComponentName(name) ? [name] : [];
    }

    if (declaration?.type !== "VariableDeclaration") return [];

    return declaration.declarations.flatMap(({ id, init }) =>
      id.type === "Identifier" &&
      isComponentName(id.name) &&
      isComponentValue(init)
        ? [id.name]
        : [],
    );
  });
}

/**
 * Registers every component a panel module declares, exported or not, so the
 * report can tell our components from third-party ones. It runs after Vite
 * compiles TypeScript and JSX, so the module parses as JavaScript.
 */
function registerPanelComponents(): Plugin {
  return {
    name: "register-panel-components",
    transform(code, id) {
      const [file = id] = id.split("?");

      if (
        !/\/src\/panel\/.+\.tsx$/.test(file) ||
        /(\.test|-test-harness)\.tsx$/.test(file)
      ) {
        return undefined;
      }

      const names = componentNames(this.parse(code));
      if (!names.length) return undefined;

      return {
        code: [
          code,
          `import { registerComponent as __registerPanelComponent } from ${JSON.stringify(RECORDER)};`,
          ...names.map((name) => `__registerPanelComponent(${name});`),
        ].join("\n"),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), registerPanelComponents()],
  test: {
    setupFiles: ["./dev/register-providers.ts"],
    include: ["tests/ui/render-audit/render-report.report.ts"],
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://localhost/", pretendToBeVisual: true },
    },
    restoreMocks: true,
    testTimeout: 60_000,
  },
});
