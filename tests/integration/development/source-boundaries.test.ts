import assert from "node:assert/strict";
import { resolve } from "node:path";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { test } from "vitest";

// Fixture paths don't exist, so they can't join a tsconfig program.
const eslint = new ESLint({
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function boundaryMessages(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, {
    filePath: resolve(filePath),
  });

  assert.ok(result, "ESLint must return a result for the fixture");
  assert.equal(result.fatalErrorCount, 0, "Fixture must parse as TypeScript");

  return result.messages.filter(
    (message) => message.ruleId === "project/source-boundaries",
  );
}

const importForms = [
  (target: string) => `import "${target}";`,
  (target: string) => `export * from "${target}";`,
  (target: string) => `export { Thing } from "${target}";`,
  (target: string) => `export const loaded = import("${target}");`,
  (target: string) => `export type Imported = import("${target}").Thing;`,
  (target: string) =>
    `import type { Thing } from "${target}"; export type { Thing };`,
];

test("production boundaries reject each forbidden dependency target", async () => {
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
      const source = `import "${target}";`;
      const messages = await boundaryMessages(filePath, source);

      assert.equal(messages.length, 1, `${filePath} must reject ${source}`);
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
      const source = `import "${target}";`;

      assert.deepEqual(
        await boundaryMessages(filePath, source),
        [],
        `${filePath} must allow ${source}`,
      );
    }
  }
});

// Syntax dispatch and dependency ownership are independent. Exercise each
// visitor with an allowed and forbidden target instead of their full product.
test("every supported import syntax enforces the same ownership boundary", async () => {
  const file = "src/service/features/tasks/runtime/example.ts";

  for (const form of importForms) {
    assert.equal(
      (await boundaryMessages(file, form("../../../../panel/app/app.js")))
        .length,
      1,
      `Must reject ${form("../../../../panel/app/app.js")}`,
    );

    assert.deepEqual(await boundaryMessages(file, form("./control.js")), []);
  }
});

test("only the Claude-owned shared contract can import SDK types, and never SDK values", async () => {
  const sdk = "@anthropic-ai/claude-agent-sdk";
  const contract = "src/shared/providers/claude/events.ts";

  for (const source of [
    `import type { Thing } from "${sdk}";`,
    `import { type Thing } from "${sdk}";`,
    `export type { Thing } from "${sdk}";`,
    `type Thing = import("${sdk}").Thing;`,
  ]) {
    assert.deepEqual(await boundaryMessages(contract, source), []);

    assert.equal(
      (await boundaryMessages("src/shared/events/types.ts", source)).length,
      1,
    );
  }

  assert.equal(
    (await boundaryMessages(contract, `import { Thing } from "${sdk}";`))
      .length,
    1,
  );
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
