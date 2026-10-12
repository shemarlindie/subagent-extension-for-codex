import assert from "node:assert/strict";
import { resolve } from "node:path";

import { ESLint } from "eslint";
import { test } from "vitest";

const eslint = new ESLint();

async function boundaryMessages(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, {
    filePath: resolve(filePath),
  });

  assert.equal(result.fatalErrorCount, 0, "Fixture must parse as TypeScript");

  return result.messages.filter(
    (message) => message.ruleId === "project/source-boundaries",
  );
}

const importForms = [
  (target: string) => `import "${target}";`,
  (target: string) => `export * from "${target}";`,
  (target: string) => `export const loaded = import("${target}");`,
  (target: string) => `export type Imported = import("${target}").Thing;`,
  (target: string) =>
    `import type { Thing } from "${target}"; export type { Thing };`,
];

test("production boundaries reject cross-runtime and development imports in every import form", async () => {
  for (const [filePath, targets] of [
    [
      "src/service/features/tasks/runtime/example.ts",
      [
        "../../../../panel/app/app.js",
        "../../../../../dev/service/fixture-provider.js",
        "../../../../../tests/support/helpers.js",
        "./control.test.js",
      ],
    ],
    [
      "src/panel/features/tasks/chat/example.ts",
      [
        "../../../../service/platform/panel/panel.js",
        "../../../../../dev/panel/scenarios/fixtures.js",
        "../../../../../tests/support/helpers.js",
        "../../../app/state/controller-test-harness",
        "node:fs",
        "fs/promises",
      ],
    ],
    [
      "src/shared/tasks/example.ts",
      [
        "../../service/features/tasks/runtime/control.js",
        "../../panel/app/state/controller.js",
        "../../../dev/panel/scenarios/fixtures.js",
        "../../../tests/support/helpers.js",
        "node:path",
        "path",
        "@anthropic-ai/claude-agent-sdk",
        "drizzle-orm/sqlite-core",
      ],
    ],
  ] as const) {
    for (const target of targets) {
      for (const form of importForms) {
        const messages = await boundaryMessages(filePath, form(target));

        assert.equal(
          messages.length,
          1,
          `${filePath} must reject ${form(target)}`,
        );
      }
    }
  }
});

test("production boundaries allow imports within their runtime and shared feature modules", async () => {
  for (const [filePath, targets] of [
    [
      "src/service/features/tasks/runtime/example.ts",
      [
        "./control.js",
        "../../../platform/panel/panel.js",
        "../../../../shared/tasks/model.js",
        "node:fs",
        "@anthropic-ai/claude-agent-sdk",
      ],
    ],
    [
      "src/service/platform/panel/example.ts",
      ["./panel.js", "../../../shared/panel/panel-contract.js"],
    ],
    [
      "src/panel/features/tasks/chat/example.ts",
      ["./chat.js", "../../../../shared/tasks/model.js", "react"],
    ],
    [
      "src/shared/tasks/example.ts",
      ["./model.js", "../providers/metadata.js", "zod"],
    ],
  ] as const) {
    for (const target of targets) {
      for (const form of importForms) {
        assert.deepEqual(
          await boundaryMessages(filePath, form(target)),
          [],
          `${filePath} must allow ${form(target)}`,
        );
      }
    }
  }
});

test("colocated production tests and test harnesses may import fixtures and other runtimes", async () => {
  for (const filePath of [
    "src/service/features/tasks/runtime/example.test.ts",
    "src/panel/features/tasks/chat/example.test.tsx",
    "src/panel/app/state/example-test-harness.ts",
    "src/shared/tasks/example.test.ts",
  ]) {
    assert.deepEqual(
      await boundaryMessages(
        filePath,
        'import "node:fs"; import "@anthropic-ai/claude-agent-sdk"; import "/dev/panel/scenarios/fixtures.js";',
      ),
      [],
      `${filePath} must be exempt from production import boundaries`,
    );
  }
});
