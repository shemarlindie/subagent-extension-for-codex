import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import { packagePath } from "../../../platform/service/runtime.js";
import { claudeBinaryName, claudeExecutable } from "./executable.js";

test("source runs leave the executable to the SDK's platform package", () => {
  assert.equal(claudeExecutable(), undefined);
  assert.equal(claudeExecutable(fileURLToPath(import.meta.url)), undefined);
});

test("built code runs the binary copied into dist/claude", () => {
  const expected = packagePath("dist", "claude", claudeBinaryName);

  for (const module of ["main.js", "chunks/chunk-ABC123.js"])
    assert.equal(claudeExecutable(packagePath("dist", module)), expected);
});

test("a sibling directory that only shares the dist prefix is not built code", () => {
  assert.equal(claudeExecutable(packagePath("dist-old", "main.js")), undefined);
});
