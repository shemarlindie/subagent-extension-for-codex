import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished, test } from "vitest";

import { workspaceFilePath } from "./paths.js";

// changePath's own rules, such as symlink escapes, are covered with the change store.
test("workspace file paths resolve to existing files and say why others can't open", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "subagent-extension-for-codex-test-")),
  );

  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src", "a.ts"), "");

  assert.equal(
    await workspaceFilePath(workspace, "src/a.ts"),
    join(workspace, "src", "a.ts"),
  );

  for (const [path, reason] of [
    ["../outside.ts", /outside the task workspace/],
    ["src/missing.ts", /src\/missing\.ts doesn't exist/],
    ["src", /src isn't a file/],
  ] as const) {
    await assert.rejects(workspaceFilePath(workspace, path), reason);
  }

  await assert.rejects(
    workspaceFilePath(join(root, "removed"), "a.ts"),
    /workspace was removed/,
  );
});
