import assert from "node:assert/strict";

import { test } from "vitest";

import { nodeVersionError } from "./node-version.js";

test("accepts the minimum major version and later", () => {
  assert.equal(nodeVersionError("24.0.0", "/usr/bin/node", 24), undefined);
  assert.equal(nodeVersionError("25.2.1", "/usr/bin/node", 24), undefined);
});

test("names the found runtime, its version and the requirement", () => {
  assert.equal(
    nodeVersionError("22.11.0", "/usr/bin/node", 24),
    "codex-subagent-extension needs Node.js 24 or later, but /usr/bin/node is Node.js 22.11.0.\n" +
      "Install Node.js 24 or later from https://nodejs.org and make sure it is first on the PATH Codex uses.",
  );
});
