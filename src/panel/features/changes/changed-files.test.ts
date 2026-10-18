import assert from "node:assert/strict";

import { expect, test } from "vitest";

import {
  changedFileDiff,
  changedFileEntries,
  opensByDefault,
} from "./changed-files";
import type { Changes } from "./types";
import { nextUnviewed } from "./use-viewed-files";

const changes: Changes = {
  scope: "task",
  files: [
    {
      path: "a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      source: "tool",
      incomplete: false,
    },
    {
      path: "logo.png",
      status: "modified",
      additions: 0,
      deletions: 0,
      source: "command",
      incomplete: true,
    },
    {
      path: "b.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      source: "tool",
      incomplete: false,
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

test("binary files have no diff", () => {
  assert.equal(changedFileDiff(changes, "logo.png"), undefined);
});

test("each read's diff is parsed once, however many views ask", () => {
  assert.equal(changedFileEntries(changes), changedFileEntries(changes));

  assert.notEqual(
    changedFileEntries({ ...changes }),
    changedFileEntries(changes),
  );
});

test("a file's signature changes only when its changes do", () => {
  const signature = (diff: string) =>
    changedFileEntries({ ...changes, diff }).map((entry) => entry.signature);

  const [a, logo, b] = signature(changes.diff);

  assert.deepEqual(signature(changes.diff), [a, logo, b]);

  const [changedA, sameLogo, sameB] = signature(
    changes.diff.replace("+new", "+newer"),
  );

  assert.notEqual(changedA, a);
  assert.equal(sameLogo, logo);
  assert.equal(sameB, b);
});

const [aDiff, logoDiff, bDiff] = [
  "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
  "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n",
  "diff --git a/b.ts b/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1 @@\n+added\n",
];

const diffs = (changes: Changes) =>
  changedFileEntries(changes).map((entry) => ({
    path: entry.diff.to,
    lines: entry.diff.chunks.length,
    missing: entry.missing ?? false,
  }));

test("files take their own part of the diff, whatever its order", () => {
  assert.deepEqual(diffs({ ...changes, diff: bDiff + aDiff + logoDiff }), [
    { path: "a.ts", lines: 1, missing: false },
    { path: "logo.png", lines: 0, missing: false },
    { path: "b.ts", lines: 1, missing: false },
  ]);
});

test("a file the diff leaves out gets a stand-in without shifting the rest", () => {
  const partial = { ...changes, diff: aDiff + bDiff };

  assert.deepEqual(diffs(partial), [
    { path: "a.ts", lines: 1, missing: false },
    { path: "logo.png", lines: 0, missing: true },
    { path: "b.ts", lines: 1, missing: false },
  ]);

  const entries = changedFileEntries({ ...partial, diff: "" });
  const b = entries[2];
  assert.equal(entries.length, 3);
  assert.ok(b);

  // A stand-in keeps the file's status, and offers no Diff view. A path the
  // changes don't list has none either.
  assert.equal(b.diff.new, true);
  assert.equal(b.diff.additions, 1);
  assert.equal(changedFileDiff({ ...partial, diff: "" }, "b.ts"), undefined);
  assert.equal(changedFileDiff(partial, "missing.ts"), undefined);
});

test("a path Git quoted in the diff matches its file by path, not place", () => {
  const [aFile] = changes.files;
  assert.ok(aFile);

  // As Git writes it: the tab as the two characters \t.
  const quoted = String.raw`diff --git "a/tab\tname.ts" "b/tab\tname.ts"
--- "a/tab\tname.ts"
+++ "b/tab\tname.ts"
@@ -1 +1 @@
-old
+new
`,
    [tabbed, a] = changedFileEntries({
      ...changes,
      files: [{ ...aFile, path: "tab\tname.ts" }, aFile],
      // Out of order, so only the path can pair them.
      diff: aDiff + quoted,
    });

  assert.ok(tabbed && a);
  assert.equal(tabbed.diff.to, "tab\tname.ts");
  assert.equal(tabbed.missing, undefined);
  assert.equal(a.diff.to, "a.ts");
});

test("the next unread file follows the current one, wrapping to the start", () => {
  const [a, logo, b] = changedFileEntries(changes);
  assert.ok(a && logo && b);

  const viewed = (...entries: (typeof a)[]) =>
    new Map(entries.map((entry) => [entry.file.path, entry.signature]));

  assert.equal(nextUnviewed(viewed(), [a, logo, b], a), logo);
  assert.equal(nextUnviewed(viewed(logo), [a, logo, b], a), b);
  assert.equal(nextUnviewed(viewed(a), [a, logo, b], b), logo);
  // None left but the current file.
  assert.equal(nextUnviewed(viewed(logo, b), [a, logo, b], a), undefined);
});

test("short lists open every file and long lists only the first", () => {
  const entries = (count: number) =>
    changedFileEntries({
      scope: "task",
      additions: 0,
      deletions: 0,
      diff: "",
      files: Array.from({ length: count }, (_, index) => ({
        path: `file-${index}`,
        status: "modified",
        additions: 0,
        deletions: 0,
        source: "tool",
        incomplete: false,
      })),
    });

  const short = entries(3),
    long = entries(9);

  expect(short.map((_, i) => opensByDefault(short, i))).toEqual([
    true,
    true,
    true,
  ]);

  expect(long.map((_, i) => opensByDefault(long, i))).toEqual([
    true,
    ...Array<boolean>(8).fill(false),
  ]);
});
