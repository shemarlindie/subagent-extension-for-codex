import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { test, type TestContext } from "vitest";

const repository = fileURLToPath(new URL("../../../", import.meta.url));

const contracts = [
  "src/shared/settings/document-contract",
  "src/shared/panel/panel-contract",
];

const panelContract = "src/shared/panel/panel-contract.ts";

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "schema-generation-"));

  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));

  for (const file of [
    "scripts/generate-schemas.mjs",
    "eslint.config.js",
    "scripts/lint/source-boundaries.mjs",
    "package.json",
    ...contracts.map((contract) => `${contract}.ts`),
  ]) {
    const destination = join(directory, file);

    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repository, file), destination);
  }

  symlinkSync(
    join(repository, "node_modules"),
    join(directory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  return directory;
}

const execFileAsync = promisify(execFile);

type Run = { status: number; stdout: string; stderr: string };

/**
 * Runs Node in a fixture without blocking the event loop, so the file's
 * tests can overlap. A nonzero exit is a result, not an error.
 */
async function run(directory: string, args: string[]): Promise<Run> {
  try {
    const output = await execFileAsync(process.execPath, args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
    });

    return { status: 0, ...output };
  } catch (error) {
    // A spawn failure or timeout has no numeric exit code.
    const {
      code,
      stdout = "",
      stderr = "",
    } = error as {
      code?: unknown;
      stdout?: string;
      stderr?: string;
    };

    if (typeof code !== "number") throw error;

    return { status: code, stdout, stderr };
  }
}

function generate(directory: string, check = false) {
  return run(directory, [
    "scripts/generate-schemas.mjs",
    ...(check ? ["--check"] : []),
  ]);
}

function snapshot(directory: string) {
  return contracts.map((contract) => {
    const file = join(directory, `${contract}.generated.ts`);

    return {
      source: readFileSync(file, "utf8"),
      modified: statSync(file, { bigint: true }).mtimeNs,
    };
  });
}

test.concurrent(
  "generates validators and checks fresh or stale outputs without rewriting files",
  async (t) => {
    const directory = fixture(t);

    // An importer keeps a helper schema public.
    writeFileSync(
      join(directory, "src/shared/settings/row-consumer.ts"),
      'import { settingRowSchema } from "./document-contract.generated.js";\n',
    );

    const generated = await generate(directory);

    assert.equal(generated.status, 0, generated.stderr);

    const before = snapshot(directory);

    const imported = await run(directory, [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `import { settingRowSchema } from "./src/shared/settings/document-contract.generated.ts";
settingRowSchema.safeParse({});
`,
    ]);

    assert.equal(imported.status, 0, imported.stderr);

    const checked = await generate(directory, true);

    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(snapshot(directory), before);

    const staleFile = join(directory, `${contracts[0]}.generated.ts`);

    writeFileSync(staleFile, `${readFileSync(staleFile, "utf8")}\n// stale\n`);

    const staleBefore = snapshot(directory);
    const staleCheck = await generate(directory, true);

    assert.notEqual(staleCheck.status, 0);

    assert.match(
      staleCheck.stderr,
      /Stale schema:.*Run npm run schemas:generate/,
    );

    assert.deepEqual(snapshot(directory), staleBefore);
  },
);

test.concurrent(
  "rejects a type imported from outside a contract before writing a permissive validator",
  async (t) => {
    const directory = fixture(t);
    const generated = await generate(directory);

    assert.equal(generated.status, 0, generated.stderr);

    const file = join(directory, panelContract);
    const source = readFileSync(file, "utf8");

    writeFileSync(
      join(dirname(file), "unmapped.ts"),
      "export interface Unmapped { value: string; }\n",
    );

    writeFileSync(
      file,
      `import type { Unmapped } from "./unmapped.js";\n${source.replace(
        "export interface PanelOutput {",
        "export interface PanelOutput {\n  unmapped?: Unmapped;",
      )}`,
    );

    const before = readFileSync(
      join(directory, `${contracts[1]}.generated.ts`),
      "utf8",
    );

    const result = await generate(directory);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Permissive validator.*panel-contract.ts/);

    const after = readFileSync(
      join(directory, `${contracts[1]}.generated.ts`),
      "utf8",
    );

    assert.equal(after, before);
    assert.doesNotMatch(after, /\bz\.any\(\)/);
  },
);

test.concurrent(
  "maps cross-folder contract imports to generated validators using module separators",
  async (t) => {
    const directory = fixture(t);
    const file = join(directory, panelContract);
    const source = readFileSync(file, "utf8");

    writeFileSync(
      file,
      `import type { SettingOption } from "../settings/document-contract.js";\n${source.replace(
        "export interface PanelOutput {",
        "export interface PanelOutput {\n  options?: SettingOption[];",
      )}`,
    );

    const result = await generate(directory);

    assert.equal(result.status, 0, result.stderr);

    const output = readFileSync(
      join(directory, `${contracts[1]}.generated.ts`),
      "utf8",
    );

    assert.match(
      output,
      /import \{ settingOptionSchema \} from "\.\.\/settings\/document-contract\.generated\.js"/,
    );

    assert.match(
      output,
      /options: z\.array\(settingOptionSchema\)\.optional\(\)/,
    );

    const checked = await generate(directory, true);

    assert.equal(checked.status, 0, checked.stderr);
  },
);

test.concurrent(
  "discovers nested feature contracts and reports missing outputs without writing in check mode",
  async (t) => {
    const directory = fixture(t);
    const feature = join(directory, "src/service/features/new-feature/nested");
    const output = join(feature, "message-contract.generated.ts");
    const initial = await generate(directory);

    assert.equal(initial.status, 0, initial.stderr);

    const before = snapshot(directory);

    mkdirSync(feature, { recursive: true });

    writeFileSync(
      join(feature, "message-contract.ts"),
      "export interface Message { text: string; }\n",
    );

    writeFileSync(
      join(feature, "message-contract.test.ts"),
      "export interface TestOnly { value: number; }\n",
    );

    const missing = await generate(directory, true);

    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /message-contract\.generated\.ts/);
    assert.match(missing.stderr, /Run npm run schemas:generate/);
    assert.equal(existsSync(output), false);
    assert.deepEqual(snapshot(directory), before);

    const generated = await generate(directory);

    assert.equal(generated.status, 0, generated.stderr);
    assert.match(readFileSync(output, "utf8"), /export const messageSchema/);

    assert.equal(
      existsSync(join(feature, "message-contract.test.generated.ts")),
      false,
    );

    const checked = await generate(directory, true);

    assert.equal(checked.status, 0, checked.stderr);
  },
);

test.concurrent(
  "rejects checking from a directory without discovered contracts",
  async (t) => {
    const directory = fixture(t);

    rmSync(join(directory, "src"), { recursive: true, force: true });

    const result = await generate(directory, true);

    assert.notEqual(result.status, 0);

    assert.match(
      result.stderr,
      /No schema contracts found under src\. Run this command from the project root\./,
    );
  },
);
