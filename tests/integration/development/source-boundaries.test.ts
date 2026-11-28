import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, test } from "vitest";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const oxlint = join(repository, "node_modules/oxlint/bin/oxlint");
const execFileAsync = promisify(execFile);

// The rule reads paths relative to the working directory, so each fixture is
// written at its repository path inside a scratch root that loads only it.
const root = mkdtempSync(join(tmpdir(), "source-boundaries-"));

writeFileSync(
  join(root, ".oxlintrc.json"),
  JSON.stringify({
    jsPlugins: [join(repository, "scripts/lint/project-plugin.mjs")],
    categories: { correctness: "off" },
    rules: { "project/source-boundaries": "error" },
  }),
);

afterAll(() => rmSync(root, { recursive: true, force: true }));

type Diagnostic = { code: string; message: string };

async function boundaryMessages(filePath: string, source: string) {
  const file = join(root, filePath);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);

  let stdout: string;

  try {
    ({ stdout } = await execFileAsync(
      process.execPath,
      [oxlint, "--format", "json", filePath],
      { cwd: root, encoding: "utf8" },
    ));
  } catch (error) {
    // Oxlint exits 1 when it reports a violation.
    ({ stdout } = error as { stdout: string });
  } finally {
    rmSync(file);
  }

  const { diagnostics } = JSON.parse(stdout) as { diagnostics: Diagnostic[] };

  const messages = diagnostics.filter(
    ({ code }) => code === "project(source-boundaries)",
  );

  assert.deepEqual(
    diagnostics.filter((diagnostic) => !messages.includes(diagnostic)),
    [],
    "Fixture must parse as TypeScript",
  );

  return messages;
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
      "src/core/service/features/tasks/runtime/example.ts",
      [
        "../../../../../panel/app/app.js",
        "../../../../../../dev/service/fixture-provider.js",
        "../../../../../../tests/support/helpers.js",
        "./control.test.js",
      ],
    ],
    [
      "src/panel/features/tasks/chat/example.ts",
      [
        "../../../../core/service/platform/panel/panel.js",
        "../../../../../dev/panel/scenarios/fixtures.js",
        "../../../../../tests/support/helpers.js",
        "../../../app/state/controller-test-harness",
        "node:fs",
        "fs/promises",
      ],
    ],
    [
      "src/core/shared/tasks/example.ts",
      [
        "../../service/features/tasks/runtime/control.js",
        "../../../panel/app/state/controller.js",
        "../../../../dev/panel/scenarios/fixtures.js",
        "../../../../tests/support/helpers.js",
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

// Syntax dispatch and dependency ownership are independent. Exercise each
// visitor with an allowed and forbidden target instead of their full product.
test("every supported import syntax enforces the same ownership boundary", async () => {
  const file = "src/core/service/features/tasks/runtime/example.ts";

  for (const form of importForms) {
    assert.equal(
      (await boundaryMessages(file, form("../../../../../panel/app/app.js")))
        .length,
      1,
      `Must reject ${form("../../../../../panel/app/app.js")}`,
    );

    assert.deepEqual(await boundaryMessages(file, form("./control.js")), []);
  }
});

test("only the Claude-owned shared contract can import SDK types, and never SDK values", async () => {
  const sdk = "@anthropic-ai/claude-agent-sdk";
  const contract = "src/providers/claude/shared/events.ts";

  for (const source of [
    `import type { Thing } from "${sdk}";`,
    `import { type Thing } from "${sdk}";`,
    `export type { Thing } from "${sdk}";`,
    `type Thing = import("${sdk}").Thing;`,
  ]) {
    assert.deepEqual(await boundaryMessages(contract, source), []);

    assert.equal(
      (await boundaryMessages("src/core/shared/events/types.ts", source))
        .length,
      1,
    );
  }

  assert.equal(
    (await boundaryMessages(contract, `import { Thing } from "${sdk}";`))
      .length,
    1,
  );
});
