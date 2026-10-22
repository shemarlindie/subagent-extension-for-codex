import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { test } from "vitest";

import { installRoot } from "../../../src/service/platform/service/runtime.js";

const exec = promisify(execFile);

async function tree(t: import("vitest").TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "package-root-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));

  return root;
}

test("the installed root is this checkout regardless of working directory", async (t) => {
  assert.equal(installRoot, resolve("."));

  const elsewhere = await tree(t);

  const { stdout } = await exec(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--input-type=module",
      "-e",
      `import { installRoot } from ${JSON.stringify(import.meta.resolve("../../../src/service/platform/service/runtime.ts"))}; console.log(installRoot);`,
    ],
    { cwd: elsewhere },
  );

  assert.equal(stdout.trim(), installRoot);
});
