import assert from "node:assert/strict";

import { test } from "vitest";

import { changedFileDiff } from "./changed-file-diff";
import type { Changes } from "./types";

const changes: Changes = {
  scope: "task",
  files: [
    {
      path: "a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
    },
    {
      path: "logo.png",
      status: "modified",
      additions: 0,
      deletions: 0,
      binary: true,
    },
    {
      path: "b.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      binary: false,
    },
  ],
  additions: 2,
  deletions: 1,
  diff: [
    "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
    "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n",
    "diff --git a/b.ts b/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1 @@\n+added\n",
  ].join(""),
};

test("a changed file's diff is its part of the task's diff", () => {
  assert.equal(changedFileDiff(changes, "a.ts")?.to, "a.ts");
  assert.equal(changedFileDiff(changes, "b.ts")?.to, "b.ts");
});

test("binary and unlisted files have no diff", () => {
  assert.equal(changedFileDiff(changes, "logo.png"), undefined);
  assert.equal(changedFileDiff(changes, "missing.ts"), undefined);
});
