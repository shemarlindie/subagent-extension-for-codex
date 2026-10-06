import assert from "node:assert/strict";

import { test } from "vitest";

import {
  changedFiles,
  decodeCursor,
  diffPage,
  diffParts,
  encodeCursor,
} from "./changes.js";

test("changed files join name-status and numstat, including renames and binaries", () => {
  const nameStatus = [
    "M",
    "src/a.ts",
    "R087",
    "old name.ts",
    "new name.ts",
    "A",
    "logo.png",
    "D",
    "gone.ts",
    "",
  ].join("\0");

  const numstat = [
    "3\t1\tsrc/a.ts",
    "2\t2\t",
    "old name.ts",
    "new name.ts",
    "-\t-\tlogo.png",
    "0\t4\tgone.ts",
    "",
  ].join("\0");

  assert.deepEqual(changedFiles(nameStatus, numstat), [
    {
      path: "src/a.ts",
      status: "modified",
      additions: 3,
      deletions: 1,
      binary: false,
    },
    {
      path: "new name.ts",
      old_path: "old name.ts",
      status: "renamed",
      additions: 2,
      deletions: 2,
      binary: false,
    },
    {
      path: "logo.png",
      status: "added",
      additions: 0,
      deletions: 0,
      binary: true,
    },
    {
      path: "gone.ts",
      status: "deleted",
      additions: 0,
      deletions: 4,
      binary: false,
    },
  ]);

  assert.deepEqual(changedFiles("", ""), []);
});

test("diffs split by file and page whole files, at least one per page", () => {
  const one = "diff --git a/a b/a\n+diff --git inside content\n",
    two = "diff --git a/b b/b\n-x\n",
    parts = diffParts(one + two);

  assert.deepEqual(parts, [one, two]);
  assert.deepEqual(diffPage(parts, 0, 1_000), { diff: one + two, end: 2 });
  // A file larger than the page is still sent whole, alone.
  assert.deepEqual(diffPage(parts, 0, 5), { diff: one, end: 1 });
  assert.deepEqual(diffPage(parts, 1, 5), { diff: two, end: 2 });
  assert.deepEqual(diffPage(parts, 2, 5), { diff: "", end: 2 });
  assert.deepEqual(diffParts(""), []);
});

test("cursors carry both trees and the next file", () => {
  const base = "a".repeat(40),
    current = "b".repeat(40);

  assert.deepEqual(decodeCursor(encodeCursor(base, current, 7)), {
    base,
    current,
    index: 7,
  });

  assert.throws(() => decodeCursor("HEAD:main:1"), /Invalid changes cursor/);
});
