import assert from "node:assert/strict";

import { test } from "vitest";

import {
  changeCounts,
  decodeCursor,
  decodeFileCursor,
  diffPage,
  diffParts,
  encodeCursor,
  encodeFileCursor,
} from "./changes.js";

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

test("file cursors carry the tree and the next offset", () => {
  const tree = "c".repeat(64);

  assert.deepEqual(decodeFileCursor(encodeFileCursor(tree, 1_000)), {
    tree,
    offset: 1_000,
  });

  assert.throws(() => decodeFileCursor("HEAD:1"), /Invalid file cursor/);
  assert.throws(() => decodeFileCursor(`${tree}:`), /Invalid file cursor/);
});

test("change counts keep the totals and drop the file list and diff", () => {
  const counts = changeCounts({
    scope: "task",
    files: [
      {
        path: "a",
        status: "added",
        additions: 3,
        deletions: 1,
        source: "tool",
        incomplete: false,
      },
    ],
    additions: 3,
    deletions: 1,
    diff: "diff --git a/a b/a",
    next_cursor: "2",
  });

  assert.deepEqual(counts, {
    scope: "task",
    files: 1,
    additions: 3,
    deletions: 1,
  });
});
